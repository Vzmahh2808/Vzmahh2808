"""Движок бумажной торговли.

Получает поток событий (живой или из записи) и прогоняет через него несколько
стратегий одновременно. Каждая стратегия торгует на своём бумажном счёте и не
влияет на рынок и на другие стратегии.

Формат событий (одна строка JSON в записи):
  {"k":"px",    "t":..., "a":"btc", "st":src_ts, "p":price}         цена Chainlink
  {"k":"mkt",   "t":..., "slug":..., "a":"btc", "start":..., "end":...,
                "up":token, "down":token, "cond":..., "fee":0.07, "tick":0.01, "min":5}
  {"k":"book",  "t":..., "tok":token, "bids":[[p,s],...], "asks":[[p,s],...]}
  {"k":"pc",    "t":..., "tok":token, "side":"BUY"|"SELL", "p":price, "s":size}
  {"k":"trade", "t":..., "tok":token, "p":price, "s":size, "side":"BUY"|"SELL"}
  {"k":"tick",  "t":..., "tok":token, "tick":0.001}
  {"k":"res",   "t":..., "slug":..., "win":"up"|"down", "src":"ws"|"gamma"}
"""

from __future__ import annotations

import math
import time
from collections import Counter
from dataclasses import dataclass, field, fields
from typing import Callable

from .book import Book
from .model import PriceTrack, fair_up

UP, DOWN = "up", "down"
SIDES = (UP, DOWN)
EPS = 1e-9


class UsageError(ValueError):
    """Ошибка во входных данных пользователя (параметры, файлы) — печатается без трассировки."""


def other(side: str) -> str:
    return DOWN if side == UP else UP


def floor_tick(x: float, tick: float) -> float:
    return round(math.floor(x / tick + EPS) * tick, 4)


@dataclass
class Params:
    # общее
    latency_ms: float = 250.0         # задержка выставления/отмены/исполнения ордера
    fee_rate: float | None = None     # None = брать из данных рынка (feeSchedule)
    vol_annual_init: float = 0.50     # стартовая годовая волатильность до разогрева оценки
    vol_halflife_s: float = 300.0     # полураспад EWMA-оценки волатильности
    warmup_s: float = 3.0             # не торговать первые N секунд окна
    stop_before_end_s: float = 15.0   # и последние N секунд
    max_price_age_s: float = 5.0      # цена старше — поток завис, не торгуем
    settle_delay_s: float = 3.0       # через сколько после конца окна считать итог по Chainlink
    strategies: list = field(default_factory=lambda: ["taker", "maker", "maker_touch"])
    # taker: покупает по рынку, когда аск ниже честной цены с запасом
    taker_min_edge: float = 0.03      # минимум (честная цена - аск - комиссия), в долларах на акцию
    taker_size: float = 10.0          # акций за раз
    taker_max_shares: float = 100.0   # максимум акций одной стороны за окно
    taker_cooldown_s: float = 1.0
    # maker: лимитные заявки на обе стороны, собирает пары Up+Down дешевле $1
    maker_half_spread: float = 0.03   # насколько ниже честной цены ставить заявку
    maker_size: float = 10.0
    maker_max_shares: float = 100.0
    maker_max_imbalance: float = 20.0 # перекос Up/Down, после которого тяжёлую сторону не покупаем
    maker_min_pair_edge: float = 0.02 # докупая вторую ногу, пара должна стоить не дороже $1 - это

    @classmethod
    def from_dict(cls, data: dict) -> "Params":
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(data) - known)
        if unknown:
            raise UsageError(f"неизвестные параметры: {', '.join(unknown)}")
        return cls(**data)


@dataclass
class Window:
    slug: str
    asset: str
    start: float
    end: float
    tokens: dict
    cond: str = ""
    fee_rate: float = 0.07
    min_size: float = 5.0
    tick: dict = field(default_factory=lambda: {UP: 0.01, DOWN: 0.01})
    books: dict = field(default_factory=lambda: {UP: Book(), DOWN: Book()})
    open_px: float | None = None
    close_px: float | None = None
    winner: str | None = None
    winner_src: str = ""
    official: bool = False


@dataclass
class Account:
    shares: dict = field(default_factory=lambda: {UP: 0.0, DOWN: 0.0})
    cost: dict = field(default_factory=lambda: {UP: 0.0, DOWN: 0.0})  # с комиссией
    fees: float = 0.0
    volume: float = 0.0
    fills: int = 0
    pnl: float | None = None

    def avg_cost(self, side: str) -> float | None:
        return self.cost[side] / self.shares[side] if self.shares[side] > EPS else None

    def settle(self, winner: str) -> None:
        self.pnl = self.shares[winner] - self.cost[UP] - self.cost[DOWN]


class Engine:
    def __init__(self, params: Params, log: Callable[[str], None] = print, quiet: bool = False):
        self.p = params
        self.log = log
        self.quiet = quiet
        self.now = 0.0
        self.tracks: dict[str, PriceTrack] = {}
        self.windows: dict[str, Window] = {}
        self.by_token: dict[str, tuple[Window, str]] = {}
        self.by_cond: dict[str, Window] = {}
        self.accounts: dict[str, dict[str, Account]] = {}  # slug -> стратегия -> счёт
        self.settled: list[Window] = []
        self.fills: list[dict] = []
        self.stats: Counter = Counter()
        self.corrections = 0
        self.strategies = [make_strategy(name) for name in params.strategies]

    # ---------------------------------------------------------------- события

    def on_event(self, ev: dict) -> None:
        t = float(ev.get("t", self.now))
        if t > self.now:
            self.now = t
        self.stats["events"] += 1

        # 1) ордера, чья задержка истекла к этому моменту, видят стакан «до» события
        for s in self.strategies:
            s.advance(self)

        k = ev.get("k")
        touched: list[Window] = []
        if k == "px":
            track = self.tracks.get(ev["a"])
            if track is None:
                track = self.tracks[ev["a"]] = PriceTrack(self.p.vol_annual_init, self.p.vol_halflife_s)
            if track.add(float(ev["st"]), float(ev["p"]), t):
                touched = [w for w in self.windows.values()
                           if w.asset == ev["a"] and w.winner is None and w.start <= t <= w.end]
        elif k == "mkt":
            self._add_window(ev)
        elif k == "res":
            w = self.windows.get(ev.get("slug", "")) or self.by_cond.get(ev.get("cond", ""))
            if w is not None and ev.get("win") in SIDES:
                self._settle(w, ev["win"], ev.get("src", "official"), official=True)
        elif k in ("book", "pc", "trade", "tick"):
            hit = self.by_token.get(ev.get("tok", ""))
            if hit is not None:
                w, side = hit
                if k == "book":
                    w.books[side].snapshot(ev.get("bids", []), ev.get("asks", []))
                elif k == "pc":
                    w.books[side].update(ev["side"], float(ev["p"]), float(ev["s"]))
                elif k == "tick":
                    w.tick[side] = float(ev["tick"])
                # 2) исполнение уже стоящих заявок
                for s in self.strategies:
                    if k == "trade":
                        s.on_trade(self, w, side, float(ev["p"]), float(ev.get("s", 0.0)))
                    else:
                        s.on_book(self, w, side)
                if k != "trade":
                    touched = [w]

        # 3) решения стратегий
        for w in touched:
            for s in self.strategies:
                s.on_update(self, w)

        self._housekeeping()

    def _add_window(self, ev: dict) -> None:
        slug = ev["slug"]
        if slug in self.windows or any(w.slug == slug for w in self.settled):
            return
        fee = self.p.fee_rate if self.p.fee_rate is not None else float(ev.get("fee", 0.07))
        w = Window(slug=slug, asset=ev["a"], start=float(ev["start"]), end=float(ev["end"]),
                   tokens={UP: ev["up"], DOWN: ev["down"]}, cond=ev.get("cond", ""),
                   fee_rate=fee, min_size=float(ev.get("min", 5.0)))
        tick = float(ev.get("tick", 0.01))
        w.tick = {UP: tick, DOWN: tick}
        self.windows[slug] = w
        self.by_token[w.tokens[UP]] = (w, UP)
        self.by_token[w.tokens[DOWN]] = (w, DOWN)
        if w.cond:
            self.by_cond[w.cond] = w

    # ------------------------------------------------------ модель и проверки

    def fair(self, w: Window) -> float | None:
        """Честная вероятность Up по цене Chainlink."""
        track = self.tracks.get(w.asset)
        if track is None or track.last is None:
            return None
        if w.open_px is None:
            w.open_px = track.price_at(w.start)
            if w.open_px is None:
                return None
        return fair_up(track.last, w.open_px, track.var_per_s, w.end - self.now)

    def tradable(self, w: Window) -> bool:
        p = self.p
        if w.winner is not None:
            return False
        if self.now < w.start + p.warmup_s or self.now > w.end - p.stop_before_end_s:
            return False
        track = self.tracks.get(w.asset)
        if track is None or track.stale(self.now, p.max_price_age_s):
            return False
        if not (w.books[UP].ready and w.books[DOWN].ready):
            return False
        return self.fair(w) is not None

    def fee_per_share(self, w: Window, price: float) -> float:
        # комиссия тейкера Polymarket: shares * rate * p * (1 - p); мейкер платит 0
        return w.fee_rate * price * (1.0 - price)

    def latency(self) -> float:
        return self.p.latency_ms / 1000.0

    # ------------------------------------------------------------------ счета

    def peek(self, name: str, w: Window) -> Account | None:
        return self.accounts.get(w.slug, {}).get(name)

    def account(self, name: str, w: Window) -> Account:
        return self.accounts.setdefault(w.slug, {}).setdefault(name, Account())

    def fill(self, name: str, w: Window, side: str, qty: float, price: float, fee: float,
             kind: str) -> None:
        acc = self.account(name, w)
        acc.shares[side] += qty
        acc.cost[side] += qty * price + fee
        acc.fees += fee
        acc.volume += qty * price
        acc.fills += 1
        self.fills.append({"t": round(self.now, 3), "strategy": name, "slug": w.slug,
                           "side": side, "kind": kind, "qty": round(qty, 4),
                           "price": price, "fee": round(fee, 6),
                           "sec_left": round(w.end - self.now, 1)})

    # ------------------------------------------------------------------ итоги

    def _settle(self, w: Window, winner: str, src: str, official: bool) -> None:
        if w.winner is None:
            w.winner, w.winner_src, w.official = winner, src, official
            for acc in self.accounts.get(w.slug, {}).values():
                acc.settle(winner)
            self.settled.append(w)
            if not self.quiet:
                self.log(self.window_line(w))
        elif official and not w.official:
            w.official = True
            if winner != w.winner:
                self.corrections += 1
                w.winner, w.winner_src = winner, src
                for acc in self.accounts.get(w.slug, {}).values():
                    acc.settle(winner)
                if not self.quiet:
                    self.log(f"  ! {w.slug}: официальный итог {winner.upper()} расходится с "
                             f"расчётом по Chainlink, P&L пересчитан")
            else:
                w.winner_src = src

    def _housekeeping(self) -> None:
        p = self.p
        for w in list(self.windows.values()):
            if w.winner is None and self.now >= w.end + p.settle_delay_s:
                track = self.tracks.get(w.asset)
                if track is not None:
                    op = w.open_px or track.price_at(w.start)
                    cl = track.price_at(w.end)
                    if op and cl:
                        w.open_px, w.close_px = op, cl
                        self._settle(w, UP if cl >= op else DOWN, "chainlink", official=False)
            # окно держим, пока не придёт официальный итог (максимум 15 минут)
            if self.now > w.end + 60 and (w.official or self.now > w.end + 900):
                del self.windows[w.slug]
                for tok in w.tokens.values():
                    self.by_token.pop(tok, None)
                self.by_cond.pop(w.cond, None)
                if w.winner is None and self.accounts.get(w.slug):
                    self.stats["unsettled_windows"] += 1

    def window_line(self, w: Window) -> str:
        hhmm = time.strftime("%H:%M", time.localtime(w.start))
        parts = []
        for s in self.strategies:
            acc = self.peek(s.name, w)
            if acc is None or acc.fills == 0:
                parts.append(f"{s.name}: —")
            else:
                parts.append(f"{s.name}: {acc.pnl:+.2f}$ ({acc.fills} сд.)")
        totals = []
        for s in self.strategies:
            total = sum(a.pnl for a in self.iter_accounts(s.name) if a.pnl is not None)
            totals.append(f"{s.name} {total:+.2f}$")
        return (f"{hhmm} {w.asset.upper()} → {w.winner.upper():4} | " + " | ".join(parts)
                + "   Σ " + ", ".join(totals))

    def iter_accounts(self, name: str):
        for per_window in self.accounts.values():
            acc = per_window.get(name)
            if acc is not None:
                yield acc


# ================================================================ стратегии


class Strategy:
    name = "base"

    def advance(self, eng: Engine) -> None: ...
    def on_book(self, eng: Engine, w: Window, side: str) -> None: ...
    def on_trade(self, eng: Engine, w: Window, side: str, price: float, size: float) -> None: ...
    def on_update(self, eng: Engine, w: Window) -> None: ...


@dataclass
class _TakeOrder:
    exec_at: float
    slug: str
    side: str
    limit: float
    qty: float


class Taker(Strategy):
    """Покупает по рынку, когда аск дешевле честной цены больше, чем на комиссию + запас.

    Заявка исполняется через latency_ms по стакану на тот момент: если аск
    за это время ушёл вверх, сделки не будет.
    """

    def __init__(self, name: str = "taker"):
        self.name = name
        self.pending: list[_TakeOrder] = []
        self.last_sent: dict[tuple[str, str], float] = {}

    def advance(self, eng: Engine) -> None:
        if not self.pending:
            return
        due = [o for o in self.pending if o.exec_at <= eng.now]
        if not due:
            return
        self.pending = [o for o in self.pending if o.exec_at > eng.now]
        for o in due:
            w = eng.windows.get(o.slug)
            if w is None or w.winner is not None or eng.now >= w.end:
                continue
            book = w.books[o.side]
            left = o.qty
            for price, avail in book.asks_upto(o.limit, self.name):
                q = min(left, avail)
                eng.fill(self.name, w, o.side, q, price, eng.fee_per_share(w, price) * q, "taker")
                book.consume(self.name, price, q)
                left -= q
                if left <= EPS:
                    break
            if left > EPS:
                eng.stats[f"{self.name}_missed"] += 1

    def on_update(self, eng: Engine, w: Window) -> None:
        if not eng.tradable(w):
            return
        p = eng.p
        fu = eng.fair(w)
        acc = eng.peek(self.name, w)
        for side, fair in ((UP, fu), (DOWN, 1.0 - fu)):
            # самая дорогая цена в стакане, которая ещё даёт нужный запас после комиссии
            limit = None
            for ask, _ in w.books[side].asks_upto(fair, self.name):
                if fair - ask - eng.fee_per_share(w, ask) >= p.taker_min_edge:
                    limit = ask
            if limit is None:
                continue
            key = (w.slug, side)
            if eng.now - self.last_sent.get(key, -1e18) < p.taker_cooldown_s:
                continue
            held = acc.shares[side] if acc else 0.0
            pending = sum(o.qty for o in self.pending if o.slug == w.slug and o.side == side)
            qty = min(p.taker_size, p.taker_max_shares - held - pending)
            if qty < w.min_size:
                continue
            self.pending.append(_TakeOrder(eng.now + eng.latency(), w.slug, side, limit, qty))
            self.last_sent[key] = eng.now


@dataclass
class _Quote:
    slug: str
    side: str
    price: float
    qty: float
    active_at: float
    cancel_at: float | None = None
    active: bool = False
    filled: float = 0.0

    @property
    def remaining(self) -> float:
        return self.qty - self.filled


class Maker(Strategy):
    """Лимитные заявки на покупку Up и Down ниже честной цены («complete sets»).

    Если исполнились обе стороны по цене в сумме меньше $1 — прибыль при любом
    исходе. Если только одна — остаётся направленная позиция; при перекосе
    тяжёлую сторону перестаём покупать, а лёгкую поднимаем, пока пара остаётся
    дешевле $1 - maker_min_pair_edge.

    Когда считать заявку исполненной, в бумажной торговле точно не узнать
    (не видно своей очереди в стакане):
      * maker       — только если сделка прошла по цене ХУЖЕ нашей (консервативно);
      * maker_touch — если сделка прошла по нашей цене или хуже (оптимистично).
    Правда где-то между ними. В обоих режимах заявка исполняется, если в
    стакане появился продавец по нашей цене или ниже.
    """

    def __init__(self, name: str = "maker", touch: bool = False):
        self.name = name
        self.touch = touch
        self.quotes: list[_Quote] = []

    def _live(self, q: _Quote, now: float) -> bool:
        return q.active and q.remaining > EPS and (q.cancel_at is None or now < q.cancel_at)

    def advance(self, eng: Engine) -> None:
        keep = []
        for q in self.quotes:
            w = eng.windows.get(q.slug)
            if w is None or w.winner is not None or q.remaining <= EPS or eng.now >= w.end:
                continue
            if q.cancel_at is not None and eng.now >= q.cancel_at:
                continue
            if not q.active and eng.now >= q.active_at:
                ask = w.books[q.side].best_ask(self.name)
                if ask is not None and ask <= q.price + EPS:
                    # post-only заявка пересекла бы стакан — биржа её отклонит
                    eng.stats[f"{self.name}_postonly_rejects"] += 1
                    continue
                q.active = True
            keep.append(q)
        self.quotes = keep

    def _live_for(self, eng: Engine, w: Window, side: str) -> list[_Quote]:
        qs = [q for q in self.quotes if q.slug == w.slug and q.side == side and self._live(q, eng.now)]
        return sorted(qs, key=lambda q: -q.price)

    def _fill(self, eng: Engine, w: Window, q: _Quote, qty: float) -> None:
        q.filled += qty
        eng.fill(self.name, w, q.side, qty, q.price, 0.0, "maker")

    def on_trade(self, eng: Engine, w: Window, side: str, price: float, size: float) -> None:
        left = size
        for q in self._live_for(eng, w, side):
            hit = price <= q.price + EPS if self.touch else price < q.price - EPS
            if not hit or left <= EPS:
                continue
            qty = min(q.remaining, left)
            self._fill(eng, w, q, qty)
            left -= qty

    def on_book(self, eng: Engine, w: Window, side: str) -> None:
        book = w.books[side]
        for q in self._live_for(eng, w, side):
            for price, avail in book.asks_upto(q.price, self.name):
                qty = min(q.remaining, avail)
                if qty <= EPS:
                    break
                self._fill(eng, w, q, qty)
                book.consume(self.name, price, qty)

    def on_update(self, eng: Engine, w: Window) -> None:
        p = eng.p
        if not eng.tradable(w):
            if eng.now >= w.start:
                for side in SIDES:
                    self._reconcile(eng, w, side, None, 0.0)
            return
        fu = eng.fair(w)
        fairs = {UP: fu, DOWN: 1.0 - fu}
        acc = eng.peek(self.name, w)
        held = {s: (acc.shares[s] if acc else 0.0) for s in SIDES}

        targets: dict[str, float | None] = {
            s: floor_tick(fairs[s] - p.maker_half_spread, w.tick[s]) for s in SIDES
        }
        imbalance = held[UP] - held[DOWN]
        if abs(imbalance) >= p.maker_max_imbalance:
            heavy = UP if imbalance > 0 else DOWN
            light = other(heavy)
            targets[heavy] = None
            avg = acc.avg_cost(heavy) if acc else None
            if avg is not None:
                complete = floor_tick(1.0 - avg - p.maker_min_pair_edge, w.tick[light])
                cap = floor_tick(fairs[light], w.tick[light])
                targets[light] = max(targets[light], min(complete, cap))

        for side in SIDES:
            tgt = targets[side]
            tick = w.tick[side]
            if tgt is not None and held[side] >= p.maker_max_shares:
                tgt = None
            if tgt is not None:
                ask = w.books[side].best_ask(self.name)
                if ask is not None and tgt >= ask - EPS:
                    tgt = round(ask - tick, 4)  # post-only: строго ниже лучшего аска
                if tgt < tick - EPS or tgt > 1.0 - tick + EPS:
                    tgt = None
            self._reconcile(eng, w, side, tgt, held[side])

    def _reconcile(self, eng: Engine, w: Window, side: str, target: float | None,
                   held: float) -> None:
        working = [q for q in self.quotes
                   if q.slug == w.slug and q.side == side and q.cancel_at is None and q.remaining > EPS]
        cancel_at = eng.now + eng.latency()
        if target is not None and any(abs(q.price - target) < EPS for q in working):
            for q in working:
                if abs(q.price - target) >= EPS:
                    q.cancel_at = cancel_at
            return
        for q in working:
            q.cancel_at = cancel_at  # до отмены заявка ещё может исполниться
        if target is None:
            return
        p = eng.p
        qty = min(p.maker_size, p.maker_max_shares - held)
        if qty < w.min_size:
            return
        self.quotes.append(_Quote(w.slug, side, target, qty, active_at=eng.now + eng.latency()))
        eng.stats[f"{self.name}_quotes"] += 1


def make_strategy(name: str) -> Strategy:
    if name == "taker":
        return Taker("taker")
    if name == "maker":
        return Maker("maker", touch=False)
    if name == "maker_touch":
        return Maker("maker_touch", touch=True)
    raise UsageError(f"неизвестная стратегия: {name} (есть: taker, maker, maker_touch)")
