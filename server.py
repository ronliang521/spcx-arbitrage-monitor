#!/usr/bin/env python3
"""本地网页服务：静态页面 + /api/quote 聚合七所行情。"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from spread_history import (
    get_candles,
    history_meta,
    init_history,
    list_pairs,
    record_from_snapshot,
)

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
TIMEOUT = 8
QUOTE_CACHE_TTL_MS = 1200
# 递增后请重启 server.py；/api/quote 会返回此版本号便于确认是否加载新代码
CONFIG_REVISION = 3

MATRIX_COLS = ["gate", "bitget", "mexc", "binance", "okx", "tradexyz", "aster"]
MATRIX_COL_LABELS = {
    "gate": "Gate",
    "bitget": "Bitget",
    "mexc": "MEXC",
    "binance": "币安",
    "okx": "OKX",
    "tradexyz": "trade.xyz",
    "aster": "Aster",
}

VENUES: List[Dict[str, Any]] = [
    {
        "id": "binance",
        "exchange": "Binance",
        "token": "SPCXUSDT",
        "type": "永续合约",
        "shares": 11_870_000_000,
        "sharesNote": "118.7 亿股（公告口径）",
        "tradeUrl": "https://www.binance.com/zh-CN/futures/SPCXUSDT",
        "announceUrl": "https://www.binance.com/zh-CN/support/announcement/detail/4a9484ee10b347d287f514ee3fdd6a29",
    },
    {
        "id": "okx",
        "exchange": "OKX",
        "token": "SPACEX-USDT-SWAP",
        "type": "永续合约",
        "shares": 1_000_000_000,
        "sharesNote": "10 亿股 = 1,000,000,000（OKX Pre-IPO 公告预估股本）",
        "tradeUrl": "https://www.okx.com/zh-hans/trade-swap/spacex-usdt-swap",
        "announceUrl": "https://www.okx.com/zh-hans/help/okx-to-list-pre-ipo-pre-market-perpetual-futures-for-spacex-usdt-openai-usdt-and-anthropic-usdt",
    },
    {
        "id": "bitget",
        "exchange": "Bitget",
        "token": "PRESPAXUSDT",
        "type": "现货",
        "shares": 1_500_000_000_000 / 650,
        "sharesNote": "隐含估值 $1.5T，认购价 $650",
        "sharesFormula": "1500000000000/650",
        "tradeUrl": "https://www.bitget.com/zh-CN/spot/PRESPAXUSDT",
        "announceUrl": "https://www.bitget.com/zh-CN/support/articles/12560603882368",
    },
    {
        "id": "gate",
        "exchange": "Gate",
        "token": "SPCX_USDT",
        "type": "现货",
        "shares": 1_400_000_000_000 / 590,
        "sharesNote": "隐含市值 $1.4T，认购价 $590",
        "sharesFormula": "1400000000000/590",
        "tradeUrl": "https://www.gate.com/zh/trade/SPCX_USDT",
        "announceUrl": "https://www.gate.com/zh/announcements/article/50724",
    },
    {
        "id": "mexc",
        "exchange": "MEXC",
        "token": "SPACEX(PRE)USDT",
        "type": "现货",
        "shares": 1_500_000_000_000 / 650,
        "sharesNote": "隐含实体估值 $1.5T，认购价 $650",
        "sharesFormula": "1500000000000/650",
        "tradeUrl": "https://www.mexc.com/zh-MY/exchange/SPACEX(PRE)_USDT?_from=search_spot_trade",
        "announceUrl": "https://www.mexc.com/zh-MY/announcements/article/spacex-pre-launchpad-17827791535416",
    },
    {
        "id": "aster",
        "exchange": "Aster",
        "token": "SPCXUSDT",
        "type": "永续合约",
        "shares": 11_870_000_000,
        "sharesNote": "118.7 亿股（与 Binance 口径对齐）",
        "tradeUrl": "https://www.asterdex.com/zh-CN/trade/pro/futures/SPCXUSDT",
        "announceUrl": None,
    },
    {
        "id": "tradexyz",
        "exchange": "trade.xyz",
        "token": "xyz:SPCX",
        "type": "永续合约",
        "shares": 11_870_000_000,
        "sharesNote": "118.7 亿股（与 Binance 口径对齐）",
        "tradeUrl": "https://app.trade.xyz/?market=SPCX",
        "announceUrl": None,
    },
]

BITGET_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "referer": "https://www.bitget.com/zh-CN/spot/PRESPAXUSDT",
    "origin": "https://www.bitget.com",
}

_quote_cache: Dict[str, Any] = {"at_ms": 0, "payload": None}
_session = requests.Session()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _as_float(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _fmt_usd(n: Optional[float]) -> str:
    if n is None:
        return "—"
    if n >= 1e12:
        return f"${n / 1e12:.3f}T"
    if n >= 1e9:
        return f"${n / 1e9:.2f}B"
    if n >= 1e6:
        return f"${n / 1e6:.2f}M"
    return f"${n:,.0f}"


def _fmt_price(n: Optional[float]) -> str:
    if n is None:
        return "—"
    if n >= 1000:
        return f"{n:,.2f}"
    return f"{n:,.4f}"


def _fmt_vol(n: Optional[float]) -> str:
    """24h 成交额（USDT）"""
    if n is None:
        return "—"
    if n >= 1e9:
        return f"${n / 1e9:.2f}B"
    if n >= 1e6:
        return f"${n / 1e6:.2f}M"
    if n >= 1e3:
        return f"${n / 1e3:.1f}K"
    return f"${n:.0f}"


def _fmt_shares_display(shares: float, venue_id: str) -> str:
    """中文股本展示，避免 10B 被误读为 100 亿。"""
    if venue_id == "okx":
        return "10 亿股"
    if venue_id in ("binance", "aster", "tradexyz"):
        return "118.7 亿股"
    yi = shares / 100_000_000
    if yi >= 1:
        return f"{yi:.4g} 亿股"
    return f"{shares:,.0f} 股"


def _spread_pct(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None or a <= 0:
        return None
    return ((b - a) / a) * 100.0


def _fetch_binance() -> Dict[str, Any]:
    r = _session.get(
        "https://fapi.binance.com/fapi/v1/ticker/24hr",
        params={"symbol": "SPCXUSDT"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    d = r.json()
    return {"price": _as_float(d.get("lastPrice")), "volume24h": _as_float(d.get("quoteVolume"))}


def _fetch_okx() -> Dict[str, Any]:
    r = _session.get(
        "https://www.okx.com/api/v5/market/ticker",
        params={"instId": "SPACEX-USDT-SWAP"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    data = r.json().get("data") or []
    if not data:
        return {"error": "empty"}
    row = data[0]
    last = _as_float(row.get("last"))
    # volCcy24h = 24h 成交量（标的币 SPACEX 张数×面值）；成交额(USDT) ≈ volCcy24h × 最新价
    vol_base = _as_float(row.get("volCcy24h"))
    quote_vol = vol_base * last if vol_base is not None and last is not None else None
    return {"price": last, "volume24h": quote_vol}


def _fetch_gate() -> Dict[str, Any]:
    r = _session.get(
        "https://api.gateio.ws/api/v4/spot/tickers",
        params={"currency_pair": "SPCX_USDT"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        return {"error": "empty"}
    row = data[0]
    return {"price": _as_float(row.get("last")), "volume24h": _as_float(row.get("quote_volume"))}


def _fetch_bitget() -> Dict[str, Any]:
    try:
        r = _session.get(
            "https://api.bitget.com/api/v2/spot/market/tickers",
            params={"symbol": "PRESPAXUSDT"},
            headers=BITGET_HEADERS,
            timeout=TIMEOUT,
        )
        if r.ok:
            data = r.json().get("data") or []
            if data:
                row = data[0]
                return {
                    "price": _as_float(row.get("lastPr")),
                    "volume24h": _as_float(row.get("quoteVolume")) or _as_float(row.get("usdtVolume")),
                }
        r2 = _session.get(
            "https://api.bitget.com/api/v2/spot/market/fills",
            params={"symbol": "PRESPAXUSDT", "limit": "1"},
            headers=BITGET_HEADERS,
            timeout=TIMEOUT,
        )
        r2.raise_for_status()
        fills = r2.json().get("data") or []
        if fills:
            return {"price": _as_float(fills[0].get("price")), "volume24h": None}
        return {"error": "empty"}
    except Exception as e:
        return {"error": str(e)[:80]}


def _fetch_mexc() -> Dict[str, Any]:
    r = _session.get(
        "https://api.mexc.com/api/v3/ticker/24hr",
        params={"symbol": "SPACEX(PRE)USDT"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    d = r.json()
    return {
        "price": _as_float(d.get("lastPrice")),
        "volume24h": _as_float(d.get("quoteVolume")),
    }


def _fetch_aster() -> Dict[str, Any]:
    r = _session.get(
        "https://fapi.asterdex.com/fapi/v3/ticker/24hr",
        params={"symbol": "SPCXUSDT"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    d = r.json()
    return {"price": _as_float(d.get("lastPrice")), "volume24h": _as_float(d.get("quoteVolume"))}


def _fetch_tradexyz() -> Dict[str, Any]:
    r = _session.post(
        "https://api.hyperliquid.xyz/info",
        json={"type": "metaAndAssetCtxs", "dex": "xyz"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    raw = r.json()
    if not isinstance(raw, list) or len(raw) < 2:
        return {"error": "empty"}
    universe = raw[0].get("universe") or []
    ctxs = raw[1]
    for i, u in enumerate(universe):
        if u.get("name") == "xyz:SPCX":
            ctx = ctxs[i] if i < len(ctxs) else {}
            mark = _as_float(ctx.get("markPx")) or _as_float(ctx.get("midPx"))
            return {"price": mark, "volume24h": _as_float(ctx.get("dayNtlVlm"))}
    r2 = _session.post(
        "https://api.hyperliquid.xyz/info",
        json={"type": "allMids", "dex": "xyz"},
        timeout=TIMEOUT,
    )
    r2.raise_for_status()
    mids = r2.json()
    return {"price": _as_float(mids.get("xyz:SPCX")), "volume24h": None}


FETCHERS = {
    "binance": _fetch_binance,
    "okx": _fetch_okx,
    "bitget": _fetch_bitget,
    "gate": _fetch_gate,
    "mexc": _fetch_mexc,
    "aster": _fetch_aster,
    "tradexyz": _fetch_tradexyz,
}


def _fetch_one(cfg: Dict[str, Any]) -> Dict[str, Any]:
    vid = cfg["id"]
    partial: Dict[str, Any] = {}
    try:
        partial = FETCHERS[vid]()
    except Exception as e:
        partial = {"error": str(e)[:120]}
    price = partial.get("price")
    shares = float(cfg["shares"])
    implied = price * shares if price is not None else None
    return {
        "id": vid,
        "token": cfg["token"],
        "type": cfg["type"],
        "exchange": cfg["exchange"],
        "shares": shares,
        "sharesNote": cfg["sharesNote"],
        "sharesFormula": cfg.get("sharesFormula"),
        "sharesExpandable": bool(cfg.get("sharesFormula")),
        "price": price,
        "impliedValuation": implied,
        "volume24h": partial.get("volume24h"),
        "tradeUrl": cfg["tradeUrl"],
        "announceUrl": cfg.get("announceUrl"),
        "error": partial.get("error"),
        "priceDisplay": _fmt_price(price),
        "impliedDisplay": _fmt_usd(implied),
        "volume24hDisplay": _fmt_vol(partial.get("volume24h")),
        "sharesDisplay": _fmt_shares_display(shares, vid),
    }


def build_snapshot() -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=7) as ex:
        futs = {ex.submit(_fetch_one, v): v for v in VENUES}
        for fut in as_completed(futs):
            results.append(fut.result())
    order = {v["id"]: i for i, v in enumerate(VENUES)}
    results.sort(key=lambda r: order.get(r["id"], 99))
    by_id = {r["id"]: r for r in results}

    matrix_rows = []
    for row_id in [v["id"] for v in VENUES]:
        row = by_id[row_id]
        row_impl = row.get("impliedValuation")
        cells = {}
        for col_id in MATRIX_COLS:
            if col_id == row_id:
                cells[col_id] = {"pct": 0, "label": "—", "self": True}
                continue
            col = by_id[col_id]
            pct = _spread_pct(row_impl, col.get("impliedValuation"))
            cells[col_id] = {
                "pct": pct,
                "label": "—" if pct is None else f"{pct:+.2f}%",
                "colImpl": col.get("impliedValuation"),
            }
        matrix_rows.append(
            {
                "id": row_id,
                "token": row["token"],
                "exchange": row["exchange"],
                "rowImpl": row_impl,
                "rowImplDisplay": _fmt_usd(row_impl),
                "cells": cells,
            }
        )

    highlights = []
    for row in matrix_rows:
        for col_id, cell in row["cells"].items():
            if cell.get("self"):
                continue
            pct = cell.get("pct")
            if pct is None:
                continue
            highlights.append(
                {
                    "from": row["exchange"],
                    "to": MATRIX_COL_LABELS[col_id],
                    "pct": pct,
                    "label": f"{row['exchange']} → {MATRIX_COL_LABELS[col_id]}: {pct:+.2f}%",
                }
            )
    highlights.sort(key=lambda x: abs(x["pct"]), reverse=True)

    cols = [{"key": "token", "label": "代币"}] + [
        {"key": k, "label": MATRIX_COL_LABELS[k]} for k in MATRIX_COLS
    ]

    return {
        "ok": True,
        "configRevision": CONFIG_REVISION,
        "ts": _now_ms(),
        "markets": results,
        "highlights": highlights[:6],
        "spread": {
            "note": "价差%=(列÷行−1)×100%；行/列为隐含估值；列为卖方，行为买方；正数列高于行",
            "formula": "(列 ÷ 行 − 1) × 100%",
            "columns": cols,
            "rows": matrix_rows,
        },
    }


app = FastAPI(title="SPCX Arbitrage Monitor")
init_history(DATA_DIR)


@app.get("/api/quote")
def api_quote() -> JSONResponse:
    t = _now_ms()
    if _quote_cache["payload"] and t - _quote_cache["at_ms"] < QUOTE_CACHE_TTL_MS:
        return JSONResponse(_quote_cache["payload"])
    payload = build_snapshot()
    record_from_snapshot(payload, MATRIX_COL_LABELS, data_dir=DATA_DIR)
    _quote_cache["at_ms"] = t
    _quote_cache["payload"] = payload
    return JSONResponse(payload)


@app.get("/api/spread-history/meta")
def api_spread_history_meta() -> JSONResponse:
    return JSONResponse(history_meta())


@app.get("/api/spread-history/pairs")
def api_spread_history_pairs() -> JSONResponse:
    from spread_history import EXPECTED_PAIR_COUNT

    pairs = list_pairs()
    return JSONResponse(
        {"ok": True, "pairs": pairs, "total": len(pairs), "expected": EXPECTED_PAIR_COUNT}
    )


@app.get("/api/spread-history/candles")
def api_spread_history_candles(
    row: str = Query(..., description="行交易所 id，如 gate"),
    col: str = Query(..., description="列交易所 id，如 binance"),
    tf: str = Query("1m", description="1m|5m|15m|1h"),
) -> JSONResponse:
    if tf not in ("1m", "5m", "15m", "1h"):
        tf = "1m"
    return JSONResponse(get_candles(row, col, tf))


app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")


if __name__ == "__main__":
    import os

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8080"))
    print(f"\n  SPCX 套利监控 → http://{host}:{port}")
    print(f"  价差历史数据 → http://{host}:{port}/history.html")
    if host == "0.0.0.0":
        print("  局域网：把 127.0.0.1 换成本机 IP，例如 http://192.168.x.x:8080")
    print()
    uvicorn.run(app, host=host, port=port, log_level="info")
