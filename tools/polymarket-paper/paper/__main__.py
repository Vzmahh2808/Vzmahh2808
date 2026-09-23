"""Запуск:  python -m paper live | replay ФАЙЛ... | demo   (подробности: --help)"""

from __future__ import annotations

import argparse
import asyncio
import glob
import json
import os
import sys
import time

from .engine import DOWN, UP, Engine, Params, UsageError
from .feeds import Live, Recorder, read_events
from .report import write_results

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_params(args) -> Params:
    data = {}
    if args.params:
        try:
            with open(args.params, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            raise UsageError(f"не удалось прочитать {args.params}: {e}") from e
    params = Params.from_dict(data)
    if args.latency is not None:
        params.latency_ms = args.latency
    return params


def status_line(eng: Engine) -> str:
    parts = []
    for a, track in eng.tracks.items():
        if track.stale(eng.now, eng.p.max_price_age_s) and track.last_local_t is not None:
            parts.append(f"{a.upper()}: цена не обновлялась {eng.now - track.last_local_t:.0f} с — не торгую")
    for w in sorted(eng.windows.values(), key=lambda w: w.start):
        if not (w.start <= eng.now < w.end):
            continue
        f = eng.fair(w)
        if f is None:
            parts.append(f"{w.asset.upper()}: жду цену открытия окна (первое неполное окно пропускается)")
            continue
        a_up, a_dn = w.books[UP].best_ask(), w.books[DOWN].best_ask()
        parts.append(f"{w.asset.upper()} честная Up={f:.2f}, аски Up/Down={a_up}/{a_dn}, "
                     f"до конца {int(w.end - eng.now)} с")
    totals = ", ".join(
        f"{s.name} {sum(a.pnl for a in eng.iter_accounts(s.name) if a.pnl is not None):+.2f}$"
        for s in eng.strategies)
    return " | ".join(parts + [f"итого: {totals}"])


def cmd_live(args) -> None:
    params = load_params(args)
    assets = [a.strip().lower() for a in args.assets.split(",") if a.strip()]
    eng = Engine(params)
    run_id = time.strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(args.out, f"live-{run_id}")
    rec = None
    if not args.no_record:
        os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
        rec = Recorder(os.path.join(HERE, "data", f"rec-{run_id}.jsonl.gz"))

    def sink(ev: dict) -> None:
        if rec is not None:
            rec.write(ev)
        eng.on_event(ev)

    print("Бумажная торговля на Polymarket: реальных ордеров НЕТ, нужен только интернет.")
    print(f"Рынки: {', '.join(a.upper() for a in assets)} {args.window}m, цена: {args.price_source}, "
          f"задержка ордеров {params.latency_ms:.0f} мс, стратегии: {', '.join(params.strategies)}")
    print("Итог по окну печатается через ~5 с после его конца. Остановить и посмотреть общий итог: Ctrl+C.")
    if os.name == "nt":
        print("После Ctrl+C на вопрос «Завершить выполнение пакетного файла [Y(да)/N(нет)]?» ответьте N,")
        print("иначе окно закроется. Итог в любом случае сохраняется в папку results.")
    print()
    live = Live(assets, args.window, args.price_source, sink, print, lambda: status_line(eng))
    stop_at = time.time() + args.minutes * 60 if args.minutes > 0 else None
    try:
        asyncio.run(live.run(stop_at))
    except KeyboardInterrupt:
        print("\nОстанавливаю…")
    finally:
        if rec is not None:
            rec.close()
        text = write_results(eng, out_dir, f"Живой прогон {run_id}")
        print("\n" + text)
        print(f"\nТаблицы: {os.path.abspath(out_dir)}")
        if rec is not None:
            launcher = "run-paper.cmd" if os.name == "nt" else "python -m paper"
            print(f"Запись рынка: {rec.path}")
            print(f"Прогнать её заново с другими параметрами: {launcher} replay "
                  f"{os.path.join('data', os.path.basename(rec.path))} --latency 500")


def cmd_replay(args) -> None:
    params = load_params(args)
    files = []
    for pattern in args.files:  # cmd.exe не раскрывает * сам
        found = sorted(glob.glob(pattern)) if glob.has_magic(pattern) else [pattern]
        missing = [f for f in found if not os.path.isfile(f)]
        if not found or missing:
            raise UsageError(f"файл не найден: {', '.join(missing) or pattern}")
        files += found
    eng = Engine(params, quiet=args.quiet)
    for path in files:
        n = 0
        for ev in read_events(path):
            eng.on_event(ev)
            n += 1
        print(f"{path}: {n} событий")
    run_id = time.strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(args.out, f"replay-{run_id}")
    text = write_results(eng, out_dir, f"Повтор записи: {', '.join(os.path.basename(p) for p in files)}")
    print("\n" + text)
    print(f"\nТаблицы: {os.path.abspath(out_dir)}")


def cmd_demo(args) -> None:
    from .synth import synth_events

    params = load_params(args)
    eng = Engine(params, quiet=args.quiet)
    for ev in synth_events(n_windows=args.windows, seed=args.seed):
        eng.on_event(ev)
    out_dir = os.path.join(args.out, "demo")
    text = write_results(eng, out_dir, "ДЕМО на СИНТЕТИЧЕСКИХ данных — цифры ничего не значат, "
                                       "это только проверка, что программа работает")
    print("\n" + text)


def main(argv=None) -> None:
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(prog="python -m paper",
                                 description="Бумажная торговля на 5-минутных рынках Polymarket Up/Down")
    sub = ap.add_subparsers(dest="cmd")

    def common(p):
        p.add_argument("--params", help="JSON с параметрами (см. params.example.json)")
        p.add_argument("--latency", type=float, help="задержка ордеров, мс (по умолчанию 250)")
        p.add_argument("--out", default=os.path.join(HERE, "results"), help="куда класть таблицы")

    p = sub.add_parser("live", help="подключиться к Polymarket и торговать на бумаге")
    p.add_argument("--assets", default="btc", help="через запятую: btc,eth (по умолчанию btc)")
    p.add_argument("--window", type=int, choices=[5, 15], default=5, help="длина окна, минут")
    p.add_argument("--minutes", type=float, default=0, help="сколько работать (0 = до Ctrl+C)")
    p.add_argument("--price-source", choices=["chainlink", "binance"], default="chainlink",
                   help="chainlink — источник, по которому рынок закрывается (по умолчанию)")
    p.add_argument("--no-record", action="store_true", help="не записывать рынок в data/")
    common(p)
    p.set_defaults(func=cmd_live)

    p = sub.add_parser("replay", help="прогнать стратегии по записи из data/")
    p.add_argument("files", nargs="+")
    p.add_argument("--quiet", action="store_true", help="не печатать строку на каждое окно")
    common(p)
    p.set_defaults(func=cmd_replay)

    p = sub.add_parser("demo", help="проверка установки на синтетических данных (без интернета)")
    p.add_argument("--windows", type=int, default=24)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--quiet", action="store_true")
    common(p)
    p.set_defaults(func=cmd_demo)

    args = ap.parse_args(argv)
    if not getattr(args, "func", None):
        ap.print_help()
        return
    try:
        args.func(args)
    except UsageError as e:
        print(f"Ошибка: {e}")
        sys.exit(2)


if __name__ == "__main__":
    main()
