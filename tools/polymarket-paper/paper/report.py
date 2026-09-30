"""Итоговая статистика и CSV-файлы."""

from __future__ import annotations

import csv
import math
import os
import time

from .engine import DOWN, UP, Engine


def strategy_stats(eng: Engine, name: str) -> dict:
    pnls, fills, volume, fees, paired, residual = [], 0, 0.0, 0.0, 0.0, 0.0
    for w in eng.settled:
        acc = eng.peek(name, w)
        if acc is None or acc.fills == 0 or acc.pnl is None:
            continue
        pnls.append(acc.pnl)
        fills += acc.fills
        volume += acc.volume
        fees += acc.fees
        paired += min(acc.shares[UP], acc.shares[DOWN])
        residual += abs(acc.shares[UP] - acc.shares[DOWN])
    n = len(pnls)
    total = sum(pnls)
    mean = total / n if n else 0.0
    sd = math.sqrt(sum((x - mean) ** 2 for x in pnls) / (n - 1)) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 1 else 0.0
    peak = dd = run = 0.0
    for x in pnls:
        run += x
        peak = max(peak, run)
        dd = max(dd, peak - run)
    return {
        "strategy": name, "windows": n, "fills": fills, "volume": volume, "fees": fees,
        "pnl": total, "mean": mean, "se": se, "max_drawdown": dd,
        "win_rate": sum(1 for x in pnls if x > 0) / n if n else 0.0,
        "edge_pct": 100.0 * total / volume if volume else 0.0,
        "paired_share": paired / (paired + residual) if paired + residual else 0.0,
    }


def verdict(st: dict) -> str:
    n, mean, se = st["windows"], st["mean"], st["se"]
    if n == 0:
        return "сделок не было"
    if n < 30:
        return f"мало данных ({n} окон с сделками, нужно хотя бы 30–50) — выводы делать рано"
    lo, hi = mean - 2 * se, mean + 2 * se
    if lo > 0:
        return (f"похоже на преимущество: {mean:+.2f}$ за окно (±{2 * se:.2f}). "
                "Проверьте на других днях и с большей задержкой (--latency 500)")
    if hi < 0:
        return f"стабильно теряет: {mean:+.2f}$ за окно (±{2 * se:.2f})"
    return f"неотличимо от нуля: {mean:+.2f}$ за окно (±{2 * se:.2f}) — преимущества не видно"


def summary_text(eng: Engine, title: str = "") -> str:
    lines = []
    if title:
        lines.append(title)
    settled = len(eng.settled)
    official = sum(1 for w in eng.settled if w.official)
    lines.append(f"Окон рассчитано: {settled} (подтверждено официальным итогом: {official}, "
                 f"исправлено после подтверждения: {eng.corrections})")
    if eng.stats.get("unsettled_windows"):
        lines.append(f"Окон с позициями без итога: {eng.stats['unsettled_windows']} (в P&L не вошли)")
    lines.append("")
    header = (f"{'стратегия':<12}{'окон':>6}{'сделок':>8}{'объём $':>10}{'комисс $':>10}"
              f"{'P&L $':>10}{'$/окно':>9}{'% выигр':>9}{'просадка':>10}{'пары':>7}")
    lines.append(header)
    lines.append("-" * len(header))
    for s in eng.strategies:
        st = strategy_stats(eng, s.name)
        lines.append(f"{s.name:<12}{st['windows']:>6}{st['fills']:>8}{st['volume']:>10.2f}"
                     f"{st['fees']:>10.2f}{st['pnl']:>+10.2f}{st['mean']:>+9.2f}"
                     f"{100 * st['win_rate']:>8.0f}%{st['max_drawdown']:>10.2f}"
                     f"{100 * st['paired_share']:>6.0f}%")
    lines.append("")
    for s in eng.strategies:
        lines.append(f"{s.name}: {verdict(strategy_stats(eng, s.name))}")
    lines.append("")
    lines.append("«пары» — доля акций, собранных в пары Up+Down (прибыль не зависит от исхода);")
    lines.append("остальное — ставка на направление. Ребейты мейкерам не учтены.")
    return "\n".join(lines)


def write_results(eng: Engine, out_dir: str, title: str = "") -> str:
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "windows.csv"), "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["strategy", "slug", "asset", "start_utc", "winner", "winner_src",
                     "open_px", "close_px", "up_shares", "down_shares", "cost", "fees",
                     "fills", "pnl"])
        for w in eng.settled:
            for s in eng.strategies:
                acc = eng.peek(s.name, w)
                if acc is None or acc.fills == 0:
                    continue
                wr.writerow([s.name, w.slug, w.asset,
                             time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(w.start)),
                             w.winner, w.winner_src, w.open_px, w.close_px,
                             round(acc.shares[UP], 4), round(acc.shares[DOWN], 4),
                             round(acc.cost[UP] + acc.cost[DOWN], 4), round(acc.fees, 4),
                             acc.fills, round(acc.pnl, 4)])
    with open(os.path.join(out_dir, "fills.csv"), "w", newline="", encoding="utf-8") as f:
        cols = ["t", "strategy", "slug", "side", "kind", "qty", "price", "fee", "sec_left"]
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        wr.writerows(eng.fills)
    text = summary_text(eng, title)
    with open(os.path.join(out_dir, "summary.txt"), "w", encoding="utf-8") as f:
        f.write(text + "\n")
    return text
