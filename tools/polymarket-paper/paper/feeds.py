"""Живые данные Polymarket (только публичные, без ключей) и запись в файл.

Источники:
  * Gamma API          — поиск рынков окна и официальный итог;
  * CLOB market WS     — стаканы и сделки по токенам Up/Down;
  * RTDS WS            — цена Chainlink (по ней рынки и закрываются).
"""

from __future__ import annotations

import asyncio
import gzip
import json
import time
import zlib
from collections import Counter
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Callable, Iterator

GAMMA = "https://gamma-api.polymarket.com"
CLOB_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
RTDS_WS = "wss://ws-live-data.polymarket.com"
DEFAULT_FEE = 0.07  # ставка тейкер-комиссии для крипто-рынков, если рынок её не сообщил
ASSETS = ("btc", "eth", "sol", "xrp", "doge")


# ================================================================ парсеры


def _loads(value):
    """Gamma отдаёт массивы строкой с JSON внутри — принимаем обе формы."""
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


def _float(value, default=None):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if f == f else default


def _iso(value) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _truthy(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes")
    return bool(value)


def _markets_from(payload) -> Iterator[dict]:
    items = payload if isinstance(payload, list) else [payload]
    for item in items:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("markets"), list):
            yield from (m for m in item["markets"] if isinstance(m, dict))
        elif "clobTokenIds" in item:
            yield item


def _up_down(market: dict) -> tuple[list[str], list] | None:
    outcomes = _loads(market.get("outcomes"))
    values = _loads(market.get("clobTokenIds"))
    if not (isinstance(outcomes, list) and isinstance(values, list) and len(outcomes) == len(values) == 2):
        return None
    labels = [str(o).strip().lower() for o in outcomes]
    if sorted(labels) != ["down", "up"]:
        return None
    return labels, values


def fee_rate(market: dict) -> float:
    schedule = _loads(market.get("feeSchedule"))
    if isinstance(schedule, dict) and _float(schedule.get("rate")) is not None:
        return _float(schedule.get("rate"))
    if market.get("feesEnabled") is False:
        return 0.0
    # takerBaseFee — устаревшее поле, оно завышает комиссию; не используем
    return DEFAULT_FEE


def parse_gamma_market(payload, slug: str, asset: str, start: float, window_s: float,
                       now: float) -> dict | None:
    for m in _markets_from(payload):
        ud = _up_down(m)
        if ud is None:
            continue
        labels, tokens = ud
        st, en = _iso(m.get("eventStartTime")), _iso(m.get("endDate"))
        if st is None or en is None or abs((en - st) - window_s) > 1:
            st, en = float(start), float(start + window_s)  # время из slug надёжнее заголовка
        return {
            "k": "mkt", "t": now, "slug": slug, "a": asset, "start": st, "end": en,
            "up": str(tokens[labels.index("up")]), "down": str(tokens[labels.index("down")]),
            "cond": str(m.get("conditionId") or ""), "fee": fee_rate(m),
            "tick": _float(m.get("orderPriceMinTickSize"), 0.01) or 0.01,
            "min": _float(m.get("orderMinSize"), 5.0) or 5.0,
        }
    return None


def parse_gamma_resolution(payload) -> str | None:
    """'up'/'down', если рынок закрыт и итог известен, иначе None."""
    for m in _markets_from(payload):
        if not _truthy(m.get("closed")):
            continue
        outcomes = _loads(m.get("outcomes"))
        prices = _loads(m.get("outcomePrices"))
        if not (isinstance(outcomes, list) and isinstance(prices, list) and len(outcomes) == len(prices) == 2):
            continue
        vals = [_float(x, 0.0) for x in prices]
        if max(vals) >= 0.99 and min(vals) <= 0.01:
            label = str(outcomes[vals.index(max(vals))]).strip().lower()
            if label in ("up", "down"):
                return label
    return None


def _levels(rows) -> list[list[float]]:
    out = []
    for row in rows or []:
        if isinstance(row, dict):
            p, s = _float(row.get("price")), _float(row.get("size"))
        elif isinstance(row, (list, tuple)) and len(row) >= 2:
            p, s = _float(row[0]), _float(row[1])
        else:
            continue
        if p is not None and s is not None and s > 0 and 0 < p < 1:
            out.append([p, s])
    return out


def clob_events(message, now: float) -> list[dict]:
    """Сообщение веб-сокета CLOB -> события движка."""
    items = message if isinstance(message, list) else [message]
    out: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        et = it.get("event_type")
        if et == "book":
            out.append({"k": "book", "t": now, "tok": str(it.get("asset_id", "")),
                        "bids": _levels(it.get("bids")), "asks": _levels(it.get("asks"))})
        elif et == "price_change":
            changes = it.get("price_changes")
            if not isinstance(changes, list):
                changes = it.get("changes") if isinstance(it.get("changes"), list) else [it]
            for ch in changes:
                if not isinstance(ch, dict):
                    continue
                tok = ch.get("asset_id") or it.get("asset_id")
                p, s = _float(ch.get("price")), _float(ch.get("size"), 0.0)
                side = str(ch.get("side") or "").upper()
                if tok and p is not None and side in ("BUY", "SELL"):
                    out.append({"k": "pc", "t": now, "tok": str(tok), "side": side, "p": p, "s": s})
        elif et == "last_trade_price":
            p = _float(it.get("price"))
            if it.get("asset_id") and p is not None:
                out.append({"k": "trade", "t": now, "tok": str(it["asset_id"]), "p": p,
                            "s": _float(it.get("size"), 0.0),
                            "side": str(it.get("side") or "").upper()})
        elif et == "tick_size_change":
            tick = _float(it.get("new_tick_size"))
            if it.get("asset_id") and tick:
                out.append({"k": "tick", "t": now, "tok": str(it["asset_id"]), "tick": tick})
        elif et == "market_resolved":
            out.append({"k": "_resolved", "t": now, "cond": str(it.get("market") or ""),
                        "win_tok": str(it.get("winning_asset_id") or ""),
                        "win_label": str(it.get("winning_outcome") or "").strip().lower()})
    return out


def _asset_of(symbol) -> str | None:
    s = str(symbol or "").lower()
    for a in ASSETS:
        if s.startswith(a):
            return a
    return None


def rtds_events(message, now: float, topic: str) -> list[dict]:
    """Сообщение RTDS (цены) -> события px. Понимает и обновление, и дамп истории."""
    if not isinstance(message, dict):
        return []
    if message.get("topic") not in (None, topic):
        return []
    payload = message.get("payload")
    if not isinstance(payload, dict):
        return []
    asset = _asset_of(payload.get("symbol"))
    if asset is None:
        return []
    if isinstance(payload.get("data"), list):
        points = [(d.get("timestamp"), d.get("value")) for d in payload["data"] if isinstance(d, dict)]
    else:
        points = [(payload.get("timestamp") or message.get("timestamp"), payload.get("value"))]
    out = []
    for ts, value in points:
        ts, value = _float(ts), _float(value)
        if ts is None or value is None or value <= 0:
            continue
        if ts > 1e11:
            ts /= 1000.0
        out.append({"k": "px", "t": now, "a": asset, "st": ts, "p": value})
    out.sort(key=lambda e: e["st"])
    return out


# ============================================================== запись


class Recorder:
    def __init__(self, path: str):
        self.path = path
        self.f = gzip.open(path, "wt", encoding="utf-8", compresslevel=6)
        self.n = 0
        self._flushed = time.time()

    def write(self, ev: dict) -> None:
        self.f.write(json.dumps(ev, separators=(",", ":")))
        self.f.write("\n")
        self.n += 1
        if time.time() - self._flushed > 30:
            # если окно просто закроют крестиком, запись до этого места сохранится
            self.f.flush()
            self._flushed = time.time()

    def close(self) -> None:
        self.f.close()


def read_events(path: str) -> Iterator[dict]:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        try:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    return  # оборванная последняя строка
        except (EOFError, OSError, zlib.error):
            return  # файл не закрыт до конца (программу закрыли крестиком)


# ============================================================ живой поток


class Live:
    def __init__(self, assets: list[str], window_min: int, price_source: str,
                 sink: Callable[[dict], None], log: Callable[[str], None],
                 status: Callable[[], str] | None = None):
        self.assets = assets
        self.window_s = window_min * 60
        self.label = f"{window_min}m"
        self.sink = sink
        self.log = log
        self.status = status
        if price_source == "chainlink":
            self.topic, symbols = "crypto_prices_chainlink", [f"{a}/usd" for a in assets]
        else:
            self.topic, symbols = "crypto_prices", [f"{a}usdt" for a in assets]
        self.rtds_sub = {"action": "subscribe", "subscriptions": [
            {"topic": self.topic, "type": "*", "filters": json.dumps({"symbol": s}, separators=(",", ":"))}
            for s in symbols]}
        self.markets: dict[str, dict] = {}
        self.tok_info: dict[str, tuple[str, str]] = {}
        self.cond_slug: dict[str, str] = {}
        self.failed: dict[str, float] = {}
        self.res_checked: dict[str, float] = {}
        self.resolved: set[str] = set()
        self.wanted: set[str] = set()
        self.book_seen: set[str] = set()
        self.resub_tried: set[str] = set()
        self.counts: Counter = Counter()
        self.last_t = 0.0
        self.last_px: dict[str, float] = {}
        self.clob_ok = self.rtds_ok = False
        self.rtds_ever = False
        self.http_warned = False
        self.clock_checked = False
        self.http = None

    def emit(self, ev: dict) -> None:
        t = max(float(ev["t"]), self.last_t)  # время событий не должно идти назад
        ev["t"] = round(t, 3)
        self.last_t = t
        self.counts[ev["k"]] += 1
        self.sink(ev)

    async def run(self, stop_at: float | None) -> None:
        import aiohttp

        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout, trust_env=True,
                                         headers={"User-Agent": "polymarket-paper/1.0"}) as http:
            self.http = http
            tasks = [asyncio.create_task(c) for c in (
                self._markets_loop(), self._clob_loop(), self._rtds_loop(), self._status_loop())]
            try:
                if stop_at is None:
                    await asyncio.gather(*tasks)
                else:
                    while time.time() < stop_at:
                        await asyncio.sleep(1.0)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

    # ---------------------------------------------------------------- Gamma

    async def _get_json(self, path: str, params: dict):
        import aiohttp

        try:
            async with self.http.get(GAMMA + path, params=params) as r:
                if not self.clock_checked:
                    self._check_clock(r.headers.get("Date"))
                if r.status != 200:
                    return None
                return await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            if not self.http_warned:
                self.http_warned = True
                self.log(f"Нет ответа от gamma-api.polymarket.com: {e!r}. Буду пробовать дальше.")
            return None

    def _check_clock(self, header: str | None) -> None:
        # окна считаются по UTC биржи; если часы ПК врут, «до конца окна» тоже врёт
        if not header:
            return
        self.clock_checked = True
        try:
            skew = time.time() - parsedate_to_datetime(header).timestamp()
        except (TypeError, ValueError):
            return
        if abs(skew) > 2:
            self.log(f"ВНИМАНИЕ: часы компьютера {'спешат' if skew > 0 else 'отстают'} примерно на "
                     f"{abs(skew):.0f} с. Синхронизируйте время (Windows: Параметры → Время и язык → "
                     f"Синхронизировать), иначе расчёт будет неточным.")

    async def _fetch_market(self, slug: str, asset: str, start: int) -> dict | None:
        for path in ("/events", "/markets"):
            payload = await self._get_json(path, {"slug": slug})
            ev = parse_gamma_market(payload, slug, asset, start, self.window_s, time.time())
            if ev is not None:
                return ev
        return None

    async def _markets_loop(self) -> None:
        while True:
            try:
                await self._markets_step()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - поток должен жить дальше
                self.log(f"Ошибка при поиске рынков: {e!r}")
            await asyncio.sleep(2.0)

    async def _markets_step(self) -> None:
        now = time.time()
        cur = int(now // self.window_s) * self.window_s
        for a in self.assets:
            for start in (cur, cur + self.window_s):
                slug = f"{a}-updown-{self.label}-{start}"
                if slug in self.markets or now - self.failed.get(slug, -1e18) < 15:
                    continue
                ev = await self._fetch_market(slug, a, start)
                if ev is None:
                    if slug not in self.failed and start == cur:
                        self.log(f"Рынок {slug} пока не найден, повторю через 15 с")
                    self.failed[slug] = now
                    continue
                self.markets[slug] = ev
                self.tok_info[ev["up"]] = (slug, "up")
                self.tok_info[ev["down"]] = (slug, "down")
                if ev["cond"]:
                    self.cond_slug[ev["cond"]] = slug
                self.wanted |= {ev["up"], ev["down"]}
                self.emit(ev)

        for slug, m in list(self.markets.items()):
            age = now - m["end"]
            if age > 150:  # после конца ещё ловим market_resolved
                self.wanted.discard(m["up"])
                self.wanted.discard(m["down"])
            if age > 900:
                del self.markets[slug]
                continue
            if slug in self.resolved or age < 45 or now - self.res_checked.get(slug, 0.0) < 20:
                continue
            self.res_checked[slug] = now
            win = parse_gamma_resolution(await self._get_json("/events", {"slug": slug}))
            if win is not None and slug not in self.resolved:
                self.resolved.add(slug)
                self.emit({"k": "res", "t": time.time(), "slug": slug, "win": win, "src": "gamma"})

    # ----------------------------------------------------------------- CLOB

    def _on_clob_text(self, text: str) -> None:
        if text.strip().upper() in ("PONG", "PING", ""):
            return
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return
        for ev in clob_events(data, time.time()):
            if ev["k"] == "_resolved":
                info = self.tok_info.get(ev["win_tok"])
                slug = info[0] if info else self.cond_slug.get(ev["cond"])
                win = info[1] if info else ev["win_label"]
                if slug and win in ("up", "down") and slug not in self.resolved:
                    self.resolved.add(slug)
                    self.emit({"k": "res", "t": ev["t"], "slug": slug, "win": win, "src": "ws"})
                continue
            if ev["tok"] not in self.tok_info:
                continue
            if ev["k"] == "book":
                self.book_seen.add(ev["tok"])
            self.emit(ev)

    async def _clob_loop(self) -> None:
        import aiohttp

        backoff = 1.0
        while True:
            if not self.wanted:
                await asyncio.sleep(1.0)
                continue
            try:
                async with self.http.ws_connect(CLOB_WS, max_msg_size=0) as ws:
                    subscribed = set(self.wanted)
                    await ws.send_str(json.dumps({"assets_ids": sorted(subscribed), "type": "market",
                                                  "custom_feature_enabled": True}))
                    self.clob_ok, backoff = True, 1.0
                    self.log("CLOB (стаканы): подключено")
                    now = time.time()
                    sub_time = {tok: now for tok in subscribed}
                    last_ping = last_msg = now
                    while True:
                        try:
                            msg = await ws.receive(timeout=1.0)
                        except asyncio.TimeoutError:
                            msg = None
                        now = time.time()
                        if msg is not None:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                last_msg = now
                                self._on_clob_text(msg.data)
                            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING,
                                              aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                raise ConnectionError("сервер закрыл соединение")
                        if now - last_ping >= 10:
                            await ws.send_str("PING")  # иначе сервер отключает
                            last_ping = now
                        add, rem = self.wanted - subscribed, subscribed - self.wanted
                        if add:
                            await ws.send_str(json.dumps({"assets_ids": sorted(add), "operation": "subscribe",
                                                          "custom_feature_enabled": True}))
                            subscribed |= add
                            sub_time.update({tok: now for tok in add})
                        if rem:
                            await ws.send_str(json.dumps({"assets_ids": sorted(rem), "operation": "unsubscribe"}))
                            subscribed -= rem
                        for tok in subscribed:
                            info = self.tok_info.get(tok)
                            live = info is not None and self.markets.get(info[0], {}).get("start", now) <= now
                            if (live and tok not in self.book_seen and tok not in self.resub_tried
                                    and now - sub_time.get(tok, now) > 20):
                                self.resub_tried.add(tok)
                                raise ConnectionError("нет снимка стакана после подписки, переподключаюсь")
                        if now - last_msg > 60:
                            raise ConnectionError("60 с без данных")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.clob_ok = False
                self.log(f"CLOB: {e!r} — переподключение через {backoff:.0f} с")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    # ----------------------------------------------------------------- RTDS

    async def _rtds_loop(self) -> None:
        import aiohttp

        backoff, attempts = 1.0, 0
        while True:
            try:
                async with self.http.ws_connect(RTDS_WS, max_msg_size=0) as ws:
                    await ws.send_str(json.dumps(self.rtds_sub))
                    attempts += 1
                    now = time.time()
                    last_ping = last_px = now
                    while True:
                        try:
                            msg = await ws.receive(timeout=1.0)
                        except asyncio.TimeoutError:
                            msg = None
                        now = time.time()
                        if msg is not None:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                text = msg.data.strip()
                                if text and text.lower() not in ("ping", "pong"):
                                    try:
                                        data = json.loads(text)
                                    except json.JSONDecodeError:
                                        data = None
                                    for ev in rtds_events(data, now, self.topic):
                                        if not self.rtds_ok:
                                            self.rtds_ok = self.rtds_ever = True
                                            backoff = 1.0
                                            self.log(f"Цены ({self.topic}): подключено")
                                        self.last_px[ev["a"]] = ev["p"]
                                        last_px = now
                                        self.emit(ev)
                            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING,
                                              aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                raise ConnectionError("сервер закрыл соединение")
                        if now - last_ping >= 5:
                            await ws.send_str("ping")
                            last_ping = now
                        if now - last_px > 20:
                            raise ConnectionError("20 с без цен")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.rtds_ok = False
                self.log(f"Цены: {e!r} — переподключение через {backoff:.0f} с")
                if not self.rtds_ever and attempts == 3:
                    alt = "binance" if self.topic == "crypto_prices_chainlink" else "chainlink"
                    self.log(f"Цены так и не пришли. Если не заработает, попробуйте --price-source {alt}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    # --------------------------------------------------------------- статус

    async def _status_loop(self) -> None:
        while True:
            await asyncio.sleep(30.0)
            px = ", ".join(f"{a.upper()} {p:,.2f}" for a, p in self.last_px.items()) or "нет"
            conn = f"CLOB {'✓' if self.clob_ok else '×'} цены {'✓' if self.rtds_ok else '×'}"
            try:
                extra = self.status() if self.status else ""
            except Exception as e:  # noqa: BLE001 - статус не должен ронять поток
                extra = f"(статус недоступен: {e!r})"
            self.log(f"[{time.strftime('%H:%M:%S')}] {conn} | цена: {px} | событий: "
                     f"{sum(self.counts.values())} | {extra}")
