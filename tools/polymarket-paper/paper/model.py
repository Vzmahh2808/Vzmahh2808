"""Модель «честной» вероятности Up и лента цен базового актива."""

from __future__ import annotations

import math
from bisect import bisect_left

SECONDS_PER_YEAR = 365 * 24 * 3600


def norm_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def fair_up(price: float, open_price: float, var_per_s: float, seconds_left: float) -> float:
    """P(цена в конце окна >= цены открытия) при случайном блуждании без сноса.

    Ничья считается как Up — так написано в правилах рынков.
    """
    if seconds_left <= 0:
        return 1.0 if price >= open_price else 0.0
    sigma = math.sqrt(max(var_per_s, 1e-18) * seconds_left)
    z = math.log(price / open_price) / sigma
    return min(max(norm_cdf(z), 0.001), 0.999)


class PriceTrack:
    """Цены одного актива по времени источника + EWMA-оценка волатильности.

    Время источника (``src_ts``) — это время Chainlink, по которому рынок
    определяет цену открытия и закрытия окна. Локальное время нужно только для
    проверки, что поток не завис.
    """

    def __init__(self, vol_annual_init: float, halflife_s: float, keep_s: float = 3600.0):
        self.ts: list[float] = []
        self.px: list[float] = []
        self.var_per_s = vol_annual_init ** 2 / SECONDS_PER_YEAR
        self.halflife_s = halflife_s
        self.keep_s = keep_s
        self.last_local_t: float | None = None

    def add(self, src_ts: float, price: float, local_t: float) -> bool:
        if not price or price <= 0:
            return False
        if self.ts and src_ts <= self.ts[-1]:
            # дубликат или старая точка (дамп истории при переподключении);
            # точки старше всей ленты расширяют её назад
            if src_ts < self.ts[0]:
                self.ts.insert(0, src_ts)
                self.px.insert(0, price)
            return False
        if self.ts:
            dt = max(src_ts - self.ts[-1], 0.2)
            r = math.log(price / self.px[-1])
            alpha = 1.0 - math.exp(-dt / self.halflife_s)
            self.var_per_s = (1.0 - alpha) * self.var_per_s + alpha * (r * r / dt)
        self.ts.append(src_ts)
        self.px.append(price)
        self.last_local_t = local_t
        if len(self.ts) > 20000:
            cut = bisect_left(self.ts, src_ts - self.keep_s)
            del self.ts[:cut]
            del self.px[:cut]
        return True

    @property
    def last(self) -> float | None:
        return self.px[-1] if self.px else None

    def price_at(self, t: float, max_delay: float = 5.0) -> float | None:
        """Первая цена с временем >= t — так Polymarket фиксирует open/close окна.

        Возвращает None, если лента не покрывает момент t (мы подключились
        позже или точка ещё не пришла).
        """
        if not self.ts or self.ts[0] >= t:
            return None
        i = bisect_left(self.ts, t)
        if i < len(self.ts) and self.ts[i] - t <= max_delay:
            return self.px[i]
        return None

    def stale(self, local_now: float, max_age_s: float) -> bool:
        return self.last_local_t is None or local_now - self.last_local_t > max_age_s
