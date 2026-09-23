"""Стакан одного токена (Up или Down) по данным веб-сокета Polymarket."""

from __future__ import annotations


def px_key(price: float) -> float:
    return round(float(price), 4)


class Book:
    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}
        self.ready = False  # пока не пришёл полный снимок, дельты не применяем
        # Сколько с уровня аска уже «забрали» бумажные сделки каждой стратегии.
        # Реальный стакан об этом не знает, поэтому без учёта одна и та же
        # ликвидность покупалась бы снова и снова. У каждой стратегии свой учёт —
        # счета независимы. Сбрасывается, когда уровень обновился.
        self.consumed: dict[str, dict[float, float]] = {}

    def snapshot(self, bids: list, asks: list) -> None:
        self.bids = {px_key(p): float(s) for p, s in bids if float(s) > 0}
        self.asks = {px_key(p): float(s) for p, s in asks if float(s) > 0}
        self.consumed.clear()
        self.ready = True

    def update(self, side: str, price: float, size: float) -> None:
        if not self.ready:
            return
        levels = self.bids if side == "BUY" else self.asks
        p = px_key(price)
        if size <= 0:
            levels.pop(p, None)
        else:
            levels[p] = float(size)
        if side != "BUY":
            for used in self.consumed.values():
                used.pop(p, None)

    def best_bid(self) -> float | None:
        return max(self.bids) if self.bids else None

    def best_ask(self, who: str = "") -> float | None:
        # уровни, целиком съеденные бумажными сделками стратегии who, не считаем
        used = self.consumed.get(who, {})
        live = [p for p, s in self.asks.items() if s - used.get(p, 0.0) > 1e-9]
        return min(live) if live else None

    def asks_upto(self, limit: float, who: str = "") -> list[tuple[float, float]]:
        """Доступные стратегии who уровни аска с ценой <= limit, от лучшего к худшему."""
        used = self.consumed.get(who, {})
        out = []
        for p in sorted(self.asks):
            if p > limit + 1e-9:
                break
            avail = self.asks[p] - used.get(p, 0.0)
            if avail > 1e-9:
                out.append((p, avail))
        return out

    def consume(self, who: str, price: float, qty: float) -> None:
        used = self.consumed.setdefault(who, {})
        p = px_key(price)
        used[p] = used.get(p, 0.0) + qty
