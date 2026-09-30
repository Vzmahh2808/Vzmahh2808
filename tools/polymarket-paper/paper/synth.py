"""Синтетический рынок для команды demo и тестов.

Результаты на этих данных НИЧЕГО не говорят о реальном рынке: здесь
«чужие» маркет-мейкеры нарочно котируют с запаздыванием и шумом, чтобы
у стратегий были сделки и можно было проверить, что всё работает.
"""

from __future__ import annotations

import math
import random

from .model import SECONDS_PER_YEAR, fair_up


def _book(mid: float, rng: random.Random) -> tuple[list, list]:
    mid = min(max(mid, 0.03), 0.97)
    best_bid = math.floor((mid - 0.005) * 100) / 100
    bids, asks = [], []
    for i in range(5):
        b = round(best_bid - 0.01 * i, 2)
        a = round(best_bid + 0.02 + 0.01 * i, 2)
        if 0 < b < 1:
            bids.append([b, float(rng.randint(20, 200))])
        if 0 < a < 1:
            asks.append([a, float(rng.randint(20, 200))])
    return bids, asks


def synth_events(n_windows: int = 24, seed: int = 1, window_s: int = 300,
                 t0: int = 1_760_000_100, vol_annual: float = 0.5) -> list[dict]:
    rng = random.Random(seed)
    var_s = vol_annual ** 2 / SECONDS_PER_YEAR
    sd_s = math.sqrt(var_s)
    t0 = t0 // window_s * window_s
    first, last = t0 - 60, t0 + n_windows * window_s + 10
    prices: dict[int, float] = {}
    px = 63000.0
    for s in range(first, last + 1):
        px *= math.exp(rng.gauss(0.0, sd_s))
        prices[s] = px

    events: list[dict] = []
    for s in range(first, last + 1):
        events.append({"k": "px", "t": s + 0.05, "a": "btc", "st": float(s), "p": round(prices[s], 2)})

    for i in range(n_windows):
        start, end = t0 + i * window_s, t0 + (i + 1) * window_s
        slug = f"btc-updown-5m-{start}"
        up, down = f"{slug}-up", f"{slug}-down"
        events.append({"k": "mkt", "t": start - 120.0, "slug": slug, "a": "btc", "start": start,
                       "end": end, "up": up, "down": down, "cond": f"0x{i:064x}",
                       "fee": 0.07, "tick": 0.01, "min": 5})
        open_px = prices[start]
        for s in range(start, end):
            # «рынок» видит цену с опозданием на 2 с и ошибается на пару центов
            f = fair_up(prices[s - 2], open_px, var_s, end - s) + rng.gauss(0.0, 0.02)
            ub, ua = _book(f, rng)
            db, da = _book(1.0 - f, rng)
            events.append({"k": "book", "t": s + 0.3, "tok": up, "bids": ub, "asks": ua})
            events.append({"k": "book", "t": s + 0.3, "tok": down, "bids": db, "asks": da})
            if rng.random() < 0.6:
                tok, bids, asks = (up, ub, ua) if rng.random() < 0.5 else (down, db, da)
                if rng.random() < 0.5 and bids:
                    p = bids[0][0] - (0.01 if rng.random() < 0.3 else 0.0)
                    side = "SELL"
                elif asks:
                    p, side = asks[0][0], "BUY"
                else:
                    continue
                events.append({"k": "trade", "t": s + 0.6, "tok": tok, "p": round(p, 2),
                               "s": float(rng.randint(5, 60)), "side": side})
        win = "up" if prices[end] >= open_px else "down"
        events.append({"k": "res", "t": end + 70.0, "slug": slug, "win": win, "src": "synthetic"})

    events.sort(key=lambda e: e["t"])
    return events
