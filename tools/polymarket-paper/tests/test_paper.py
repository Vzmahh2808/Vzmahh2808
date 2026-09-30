import os
import tempfile
import unittest

from paper.book import Book
from paper.engine import DOWN, UP, Engine, Params
from paper.feeds import (Recorder, clob_events, parse_gamma_market, parse_gamma_resolution,
                         read_events, rtds_events)
from paper.model import PriceTrack, fair_up
from paper.report import strategy_stats, summary_text
from paper.synth import synth_events

START = 1_760_000_100  # кратно 300
END = START + 300


def base_events(strategies, **params):
    """Рынок и цены так, чтобы окно было торгуемым с t = START + 5."""
    eng = Engine(Params(strategies=strategies, **params), quiet=True)
    eng.on_event({"k": "mkt", "t": START - 100, "slug": "s", "a": "btc", "start": START, "end": END,
                  "up": "U", "down": "D", "cond": "c", "fee": 0.07, "tick": 0.01, "min": 5})
    eng.on_event({"k": "px", "t": START - 1, "a": "btc", "st": START - 1, "p": 100.0})
    eng.on_event({"k": "px", "t": START + 0.1, "a": "btc", "st": START, "p": 100.0})
    return eng


def book(eng, t, tok, bids, asks):
    eng.on_event({"k": "book", "t": t, "tok": tok, "bids": bids, "asks": asks})


def px(eng, t, p):
    eng.on_event({"k": "px", "t": t, "a": "btc", "st": t, "p": p})


class ModelTests(unittest.TestCase):
    def test_fair_is_half_at_open_and_monotonic(self):
        v = 0.5 ** 2 / (365 * 86400)
        self.assertAlmostEqual(fair_up(100, 100, v, 300), 0.5)
        self.assertGreater(fair_up(100.1, 100, v, 300), 0.5)
        self.assertLess(fair_up(99.9, 100, v, 300), 0.5)
        # чем меньше времени осталось, тем увереннее
        self.assertGreater(fair_up(100.05, 100, v, 10), fair_up(100.05, 100, v, 200))
        self.assertEqual(fair_up(100, 100, v, 0), 1.0)  # ничья = Up

    def test_price_at_needs_coverage(self):
        tr = PriceTrack(0.5, 300)
        tr.add(START + 1, 101, 0)
        self.assertIsNone(tr.price_at(START))  # не видели цену до начала окна
        tr.add(START - 5, 99, 0)  # точка из дампа истории
        self.assertEqual(tr.price_at(START), 101)
        tr.add(START + 20, 102, 0)
        self.assertIsNone(tr.price_at(START + 10))  # дыра больше 5 с


class BookTests(unittest.TestCase):
    def test_snapshot_deltas_and_consumption(self):
        b = Book()
        b.update("SELL", 0.5, 10)  # до снимка дельты игнорируются
        self.assertIsNone(b.best_ask())
        b.snapshot([[0.48, 10], [0.47, 5]], [[0.52, 10], [0.53, 20]])
        self.assertEqual((b.best_bid(), b.best_ask()), (0.48, 0.52))
        b.consume("a", 0.52, 10)
        self.assertEqual(b.best_ask("a"), 0.53)
        self.assertEqual(b.best_ask("b"), 0.52)  # у другой стратегии свой учёт
        b.update("SELL", 0.52, 7)  # уровень обновился — снова доступен
        self.assertEqual(b.asks_upto(0.53, "a"), [(0.52, 7.0), (0.53, 20.0)])
        b.update("BUY", 0.48, 0)
        self.assertEqual(b.best_bid(), 0.47)


class TakerTests(unittest.TestCase):
    def test_buys_cheap_side_after_latency_and_pays_fee(self):
        eng = base_events(["taker"], latency_ms=250)
        px(eng, START + 4, 100.0)  # честная Up = 0.5
        book(eng, START + 5, "U", [[0.38, 50]], [[0.40, 6], [0.41, 100]])
        book(eng, START + 5, "D", [[0.58, 50]], [[0.62, 100]])
        self.assertEqual(eng.fills, [])  # заявка ещё «летит»
        px(eng, START + 5.3, 100.0)
        fills = [(f["side"], f["price"], f["qty"]) for f in eng.fills]
        self.assertEqual(fills, [(UP, 0.40, 6), (UP, 0.41, 4)])
        acc = eng.peek("taker", eng.windows["s"])
        fee = 0.07 * (6 * 0.4 * 0.6 + 4 * 0.41 * 0.59)
        self.assertAlmostEqual(acc.fees, fee)
        # Up выиграл: 10 акций * $1 минус стоимость с комиссией
        px(eng, END, 100.5)
        px(eng, END + 4, 100.5)
        self.assertEqual(eng.windows["s"].winner, UP)
        self.assertAlmostEqual(acc.pnl, 10 - (6 * 0.40 + 4 * 0.41) - fee)

    def test_no_trade_when_ask_moved_before_execution(self):
        eng = base_events(["taker"], latency_ms=250)
        px(eng, START + 4, 100.0)
        book(eng, START + 5, "D", [[0.58, 50]], [[0.62, 100]])
        book(eng, START + 5, "U", [[0.38, 50]], [[0.40, 100]])
        book(eng, START + 5.1, "U", [[0.48, 50]], [[0.52, 100]])
        px(eng, START + 5.4, 100.0)
        self.assertEqual(eng.fills, [])
        self.assertEqual(eng.stats["taker_missed"], 1)


class MakerTests(unittest.TestCase):
    def setup_quotes(self, strategies):
        eng = base_events(strategies, latency_ms=100, maker_half_spread=0.03)
        book(eng, START + 5, "U", [[0.45, 50]], [[0.55, 100]])
        book(eng, START + 5, "D", [[0.45, 50]], [[0.55, 100]])
        px(eng, START + 5.2, 100.0)  # заявки 0.47/0.47 становятся активными
        return eng

    def test_through_vs_touch_fill_rules(self):
        eng = self.setup_quotes(["maker", "maker_touch"])
        eng.on_event({"k": "trade", "t": START + 6, "tok": "U", "p": 0.47, "s": 20, "side": "SELL"})
        self.assertEqual([(f["strategy"], f["price"], f["qty"]) for f in eng.fills],
                         [("maker_touch", 0.47, 10.0)])
        eng.on_event({"k": "trade", "t": START + 6.5, "tok": "D", "p": 0.46, "s": 3, "side": "SELL"})
        got = sorted((f["strategy"], f["side"], f["qty"]) for f in eng.fills if f["side"] == DOWN)
        self.assertEqual(got, [("maker", DOWN, 3.0), ("maker_touch", DOWN, 3.0)])

    def test_pair_profit_regardless_of_outcome(self):
        eng = self.setup_quotes(["maker"])
        # продавцы пришли в стакан по нашим ценам — обе ноги исполнены
        book(eng, START + 6, "U", [[0.45, 50]], [[0.47, 10], [0.55, 100]])
        book(eng, START + 6, "D", [[0.45, 50]], [[0.47, 10], [0.55, 100]])
        acc = eng.peek("maker", eng.windows["s"])
        self.assertEqual((acc.shares[UP], acc.shares[DOWN]), (10, 10))
        px(eng, END, 99.0)
        px(eng, END + 4, 99.0)
        self.assertEqual(eng.windows["s"].winner, DOWN)
        self.assertAlmostEqual(acc.pnl, 10 * (1 - 0.47 - 0.47))
        self.assertEqual(acc.fees, 0)

    def test_strategies_do_not_share_liquidity(self):
        eng = self.setup_quotes(["maker", "maker_touch"])
        book(eng, START + 6, "U", [[0.45, 50]], [[0.47, 4], [0.55, 100]])
        got = sorted((f["strategy"], f["qty"]) for f in eng.fills)
        self.assertEqual(got, [("maker", 4.0), ("maker_touch", 4.0)])

    def test_post_only_rejected_if_book_moved(self):
        eng = base_events(["maker"], latency_ms=500, maker_half_spread=0.03)
        book(eng, START + 5, "U", [[0.45, 50]], [[0.55, 100]])
        book(eng, START + 5, "D", [[0.45, 50]], [[0.55, 100]])
        book(eng, START + 5.2, "U", [[0.40, 50]], [[0.46, 100]])  # аск ушёл ниже нашей 0.47
        px(eng, START + 5.6, 100.0)
        self.assertEqual(eng.stats["maker_postonly_rejects"], 1)
        self.assertEqual(eng.fills, [])

    def test_stops_buying_heavy_side(self):
        eng = self.setup_quotes(["maker"])
        m = eng.strategies[0]
        for i in range(3):  # Up исполняется трижды: 30 акций, перекос > 20
            eng.on_event({"k": "trade", "t": START + 6 + i, "tok": "U", "p": 0.40, "s": 10, "side": "SELL"})
            px(eng, START + 6.5 + i, 100.0)
        acc = eng.peek("maker", eng.windows["s"])
        self.assertEqual(acc.shares[UP], 20)
        live_up = [q for q in m.quotes if q.side == UP and q.cancel_at is None]
        self.assertEqual(live_up, [])
        down = [q for q in m.quotes if q.side == DOWN and q.cancel_at is None][0]
        self.assertGreater(down.price, 0.47)  # лёгкую сторону подняли, чтобы собрать пару
        self.assertLessEqual(0.47 + down.price, 1 - 0.02 + 1e-9)


class SettlementTests(unittest.TestCase):
    def test_official_result_corrects_provisional(self):
        eng = base_events(["taker"])
        book(eng, START + 5, "U", [[0.38, 50]], [[0.40, 100]])
        book(eng, START + 5, "D", [[0.58, 50]], [[0.62, 100]])
        px(eng, START + 6, 100.0)
        w = eng.windows["s"]
        acc = eng.peek("taker", w)
        px(eng, END, 100.2)
        px(eng, END + 4, 100.2)
        self.assertEqual((w.winner, w.official), (UP, False))
        self.assertGreater(acc.pnl, 0)
        eng.on_event({"k": "res", "t": END + 70, "slug": "s", "win": "down", "src": "gamma"})
        self.assertEqual((w.winner, w.official), (DOWN, True))
        self.assertLess(acc.pnl, 0)
        self.assertEqual(eng.corrections, 1)

    def test_window_without_open_price_is_skipped(self):
        eng = Engine(Params(strategies=["taker", "maker"]), quiet=True)
        eng.on_event({"k": "mkt", "t": START, "slug": "s", "a": "btc", "start": START, "end": END,
                      "up": "U", "down": "D"})
        px(eng, START + 100, 100.0)  # подключились посреди окна, истории нет
        book(eng, START + 101, "U", [[0.1, 50]], [[0.2, 100]])
        book(eng, START + 101, "D", [[0.1, 50]], [[0.2, 100]])
        px(eng, START + 102, 100.0)
        self.assertEqual(eng.fills, [])


class ParserTests(unittest.TestCase):
    def test_gamma_market_with_stringified_arrays(self):
        payload = [{"slug": "btc-updown-5m-1", "markets": [{
            "conditionId": "0xabc", "outcomes": "[\"Up\", \"Down\"]",
            "clobTokenIds": "[\"111\", \"222\"]", "eventStartTime": "2025-10-09T08:55:00Z",
            "endDate": "2025-10-09T09:00:00Z", "orderPriceMinTickSize": 0.01, "orderMinSize": 5,
            "feeSchedule": {"rate": 0.07, "takerOnly": True}, "takerBaseFee": 1000}]}]
        ev = parse_gamma_market(payload, "btc-updown-5m-1", "btc", 0, 300, 1.0)
        self.assertEqual((ev["up"], ev["down"], ev["cond"], ev["fee"]), ("111", "222", "0xabc", 0.07))
        self.assertEqual(ev["end"] - ev["start"], 300)
        self.assertIsNone(parse_gamma_market([], "x", "btc", 0, 300, 1.0))

    def test_gamma_market_down_first_and_bad_dates(self):
        payload = [{"clobTokenIds": ["9", "8"], "outcomes": ["Down", "Up"], "endDate": "garbage"}]
        ev = parse_gamma_market(payload, "s", "btc", 600, 300, 1.0)
        self.assertEqual((ev["up"], ev["down"], ev["start"], ev["end"]), ("8", "9", 600, 900))

    def test_gamma_resolution(self):
        m = {"outcomes": "[\"Up\",\"Down\"]", "outcomePrices": "[\"0\",\"1\"]", "closed": True}
        self.assertEqual(parse_gamma_resolution([{"markets": [m]}]), "down")
        m["closed"] = False
        self.assertIsNone(parse_gamma_resolution([{"markets": [m]}]))

    def test_clob_messages(self):
        msgs = [
            {"event_type": "book", "asset_id": "1", "bids": [{"price": "0.48", "size": "30"}],
             "asks": [{"price": "0.52", "size": "25"}, {"price": "0.53", "size": "0"}]},
            {"event_type": "price_change", "market": "0xm", "price_changes": [
                {"asset_id": "1", "price": "0.5", "size": "200", "side": "BUY"},
                {"asset_id": "2", "price": "0.5", "size": "0", "side": "SELL"}]},
            {"event_type": "price_change", "asset_id": "3", "changes": [{"price": "0.4", "size": "5", "side": "SELL"}]},
            {"event_type": "last_trade_price", "asset_id": "1", "price": "0.456", "size": "219.2", "side": "BUY"},
            {"event_type": "tick_size_change", "asset_id": "1", "new_tick_size": "0.001"},
            {"event_type": "market_resolved", "market": "0xm", "winning_asset_id": "1"},
        ]
        evs = clob_events(msgs, 5.0)
        self.assertEqual([e["k"] for e in evs], ["book", "pc", "pc", "pc", "trade", "tick", "_resolved"])
        self.assertEqual(evs[0]["asks"], [[0.52, 25.0]])
        self.assertEqual((evs[3]["tok"], evs[3]["side"], evs[3]["p"]), ("3", "SELL", 0.4))
        self.assertEqual(evs[4]["s"], 219.2)
        self.assertEqual(evs[6]["win_tok"], "1")

    def test_rtds_update_and_dump(self):
        upd = {"topic": "crypto_prices_chainlink", "type": "update", "timestamp": 1753314064237,
               "payload": {"symbol": "btc/usd", "timestamp": 1753314064213, "value": 63061.5}}
        ev = rtds_events(upd, 9.0, "crypto_prices_chainlink")[0]
        self.assertEqual((ev["a"], ev["st"], ev["p"]), ("btc", 1753314064.213, 63061.5))
        dump = {"topic": "crypto_prices_chainlink", "payload": {"symbol": "eth/usd", "data": [
            {"timestamp": 2000, "value": 2}, {"timestamp": 1000, "value": 1}]}}
        self.assertEqual([e["p"] for e in rtds_events(dump, 9.0, "crypto_prices_chainlink")], [1, 2])
        self.assertEqual(rtds_events(upd, 9.0, "crypto_prices"), [])


class RecorderTests(unittest.TestCase):
    def test_round_trip_and_truncated_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "r.jsonl.gz")
            rec = Recorder(path)
            for i in range(1000):
                rec.write({"k": "px", "t": i, "a": "btc", "st": i, "p": 1.0 + i})
            rec.close()
            self.assertEqual(len(list(read_events(path))), 1000)
            with open(path, "rb") as f:
                raw = f.read()
            with open(path, "wb") as f:
                f.write(raw[: len(raw) // 2])  # программу закрыли на середине записи
            got = list(read_events(path))
            self.assertLess(len(got), 1000)
            self.assertTrue(all(e["k"] == "px" for e in got))


class DemoTests(unittest.TestCase):
    def test_synthetic_run_end_to_end(self):
        eng = Engine(Params(), quiet=True)
        for ev in synth_events(n_windows=6, seed=3):
            eng.on_event(ev)
        self.assertEqual(len(eng.settled), 6)
        self.assertTrue(all(w.official for w in eng.settled))
        self.assertEqual(eng.corrections, 0)  # Chainlink-расчёт совпал с официальным
        for s in eng.strategies:
            st = strategy_stats(eng, s.name)
            self.assertGreater(st["fills"], 0)
        self.assertIn("maker_touch", summary_text(eng))

    def test_replay_equals_live(self):
        evs = synth_events(n_windows=3, seed=5)
        a = Engine(Params(), quiet=True)
        for ev in evs:
            a.on_event(dict(ev))
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "r.jsonl.gz")
            rec = Recorder(path)
            for ev in evs:
                rec.write(ev)
            rec.close()
            b = Engine(Params(), quiet=True)
            for ev in read_events(path):
                b.on_event(ev)
        self.assertEqual(a.fills, b.fills)


if __name__ == "__main__":
    unittest.main()
