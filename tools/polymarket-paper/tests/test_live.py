"""Живой поток против локальных поддельных серверов Polymarket.

Проверяет подключение, форматы подписок, разбор сообщений и переподключение.
Что настоящие серверы отвечают именно так, здесь проверить нельзя — это
видно только при запуске на реальном рынке.
"""

import asyncio
import json
import time
import unittest

from aiohttp import WSMsgType, web

from paper import feeds


class FakePolymarket:
    def __init__(self):
        self.slugs = []
        self.clob_msgs = []
        self.rtds_msgs = []
        self.clob_connections = 0

    def app(self):
        app = web.Application()
        app.router.add_get("/events", self.events)
        app.router.add_get("/markets", self.events)
        app.router.add_get("/ws/market", self.clob)
        app.router.add_get("/rtds", self.rtds)
        return app

    async def events(self, request):
        slug = request.query["slug"]
        self.slugs.append(slug)
        start = int(slug.rsplit("-", 1)[1])
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731
        return web.json_response([{"slug": slug, "markets": [{
            "conditionId": f"c-{slug}", "outcomes": '["Up", "Down"]',
            "clobTokenIds": json.dumps([f"{slug}-u", f"{slug}-d"]),
            "eventStartTime": iso(start), "endDate": iso(start + 300),
            "feeSchedule": {"rate": 0.07, "takerOnly": True}, "closed": False}]}])

    async def clob(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.clob_connections += 1
        first_conn = self.clob_connections == 1
        sent = 0
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            if msg.data == "PING":
                await ws.send_str("PONG")
                continue
            data = json.loads(msg.data)
            self.clob_msgs.append(data)
            for tok in data.get("assets_ids", []):
                await ws.send_str(json.dumps([{
                    "event_type": "book", "asset_id": tok, "market": "m",
                    "bids": [{"price": "0.47", "size": "30"}], "asks": [{"price": "0.53", "size": "25"}]}]))
                await ws.send_str(json.dumps({
                    "event_type": "price_change", "market": "m",
                    "price_changes": [{"asset_id": tok, "price": "0.52", "size": "10", "side": "SELL"}]}))
                await ws.send_str(json.dumps({
                    "event_type": "last_trade_price", "asset_id": tok, "price": "0.52", "size": "5",
                    "side": "BUY"}))
                sent += 1
            if first_conn and sent:
                await ws.close()  # сервер оборвал связь — клиент должен переподключиться
                break
        return ws

    async def rtds(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        async for msg in ws:
            if msg.type != WSMsgType.TEXT or msg.data == "ping":
                continue
            self.rtds_msgs.append(json.loads(msg.data))
            now_ms = int(time.time() * 1000)
            await ws.send_str(json.dumps({"topic": "crypto_prices_chainlink", "type": "subscribe",
                                          "payload": {"symbol": "btc/usd", "data": [
                                              {"timestamp": now_ms - 2000, "value": 63000.0},
                                              {"timestamp": now_ms - 1000, "value": 63001.0}]}}))
            for i in range(20):
                await asyncio.sleep(0.1)
                ts = int(time.time() * 1000)
                await ws.send_str(json.dumps({"topic": "crypto_prices_chainlink", "type": "update",
                                              "timestamp": ts, "payload": {
                                                  "symbol": "btc/usd", "timestamp": ts, "value": 63002.0 + i}}))
        return ws


class LiveFeedTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_against_fake_servers(self):
        fake = FakePolymarket()
        runner = web.AppRunner(fake.app())
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        saved = feeds.GAMMA, feeds.CLOB_WS, feeds.RTDS_WS
        feeds.GAMMA = f"http://127.0.0.1:{port}"
        feeds.CLOB_WS = f"ws://127.0.0.1:{port}/ws/market"
        feeds.RTDS_WS = f"ws://127.0.0.1:{port}/rtds"
        events, logs = [], []
        try:
            live = feeds.Live(["btc"], 5, "chainlink", events.append, logs.append)
            await live.run(time.time() + 4.0)
        finally:
            feeds.GAMMA, feeds.CLOB_WS, feeds.RTDS_WS = saved
            await runner.cleanup()

        kinds = {e["k"] for e in events}
        self.assertTrue({"mkt", "book", "pc", "trade", "px"} <= kinds, (kinds, logs))
        cur = int(time.time() // 300) * 300
        self.assertIn(f"btc-updown-5m-{cur}", fake.slugs)
        mkts = [e for e in events if e["k"] == "mkt"]
        self.assertEqual(len(mkts), 2)  # текущее и следующее окно
        self.assertEqual(mkts[0]["end"] - mkts[0]["start"], 300)

        sub = fake.clob_msgs[0]
        self.assertEqual(sub["type"], "market")
        self.assertTrue(sub["custom_feature_enabled"])
        self.assertEqual(len(sub["assets_ids"]), 4)
        self.assertGreaterEqual(fake.clob_connections, 2)  # переподключился после обрыва

        self.assertEqual(fake.rtds_msgs[0], {"action": "subscribe", "subscriptions": [
            {"topic": "crypto_prices_chainlink", "type": "*", "filters": '{"symbol":"btc/usd"}'}]})
        ts = [e["t"] for e in events]
        self.assertEqual(ts, sorted(ts))  # время событий не идёт назад
        self.assertTrue(any("CLOB" in line and "переподключение" in line for line in logs))


if __name__ == "__main__":
    unittest.main()
