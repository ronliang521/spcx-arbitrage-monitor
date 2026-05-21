"""价差矩阵历史：落盘 + K 线聚合。"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from matrix_config import (
    EXPECTED_SPREAD_PAIRS,
    MATRIX_COL_LABELS,
    MATRIX_COLS,
    ROW_VENUE_IDS,
    ROW_VENUE_LABELS,
)

HISTORY_MAX_TICKS = 300_000
HIST_APPEND_MIN_MS = 4_500

_lock = threading.Lock()
_ticks: List[Dict[str, Any]] = []
_last_append_ms = 0


def _pair_key(row_id: str, col_id: str) -> str:
    return f"{row_id}|{col_id}"


def init_history(data_dir: Path) -> None:
    global _ticks
    path = data_dir / "spread_ticks.ndjson"
    data_dir.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        _ticks = []
        return
    loaded: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                loaded.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if len(loaded) > HISTORY_MAX_TICKS:
        loaded = loaded[-HISTORY_MAX_TICKS:]
    _ticks = loaded


def record_from_snapshot(
    payload: Dict[str, Any],
    col_labels: Dict[str, str],
    *,
    data_dir: Path,
) -> int:
    """从 /api/quote 的 spread 矩阵写入 tick，返回本次写入条数。"""
    global _last_append_ms
    ts = int(payload.get("ts") or 0)
    if ts <= 0:
        return 0
    with _lock:
        if _last_append_ms and ts - _last_append_ms < HIST_APPEND_MIN_MS:
            return 0
        rows = (payload.get("spread") or {}).get("rows") or []
        batch: List[Dict[str, Any]] = []
        for row in rows:
            row_id = row.get("id")
            row_ex = row.get("exchange") or row_id
            if not row_id:
                continue
            cells = row.get("cells") or {}
            for col_id, cell in cells.items():
                if cell.get("self"):
                    continue
                pct = cell.get("pct")
                if pct is None:
                    continue
                batch.append(
                    {
                        "t": ts,
                        "row": row_id,
                        "col": col_id,
                        "rowEx": row_ex,
                        "colEx": col_labels.get(col_id, col_id),
                        "pct": float(pct),
                    }
                )
        if not batch:
            return 0
        _ticks.extend(batch)
        if len(_ticks) > HISTORY_MAX_TICKS:
            del _ticks[: len(_ticks) - HISTORY_MAX_TICKS]
        _last_append_ms = ts
        path = data_dir / "spread_ticks.ndjson"
        with path.open("a", encoding="utf-8") as f:
            for item in batch:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        return len(batch)


def all_spread_pairs() -> List[Dict[str, str]]:
    """固定 42 组方向（与监控页价差矩阵一一对应）。"""
    out: List[Dict[str, str]] = []
    for row_id in ROW_VENUE_IDS:
        row_ex = ROW_VENUE_LABELS.get(row_id, row_id)
        for col_id in MATRIX_COLS:
            if row_id == col_id:
                continue
            out.append(
                {
                    "key": _pair_key(row_id, col_id),
                    "row": row_id,
                    "col": col_id,
                    "label": f"{row_ex} → {MATRIX_COL_LABELS.get(col_id, col_id)}",
                }
            )
    return out


def list_pairs() -> List[Dict[str, str]]:
    return all_spread_pairs()


def _pairs_with_data() -> int:
    pairs = all_spread_pairs()
    with _lock:
        snap = list(_ticks)
    keys = {_pair_key(t["row"], t["col"]) for t in snap}
    return sum(1 for p in pairs if p["key"] in keys)


def _filter_ticks(row_id: str, col_id: str) -> List[Dict[str, Any]]:
    with _lock:
        return [t for t in _ticks if t.get("row") == row_id and t.get("col") == col_id]


def ticks_to_candles(ticks: List[Dict[str, Any]], tf: str) -> List[Dict[str, Any]]:
    tf_sec = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}.get(tf, 60)
    tf_ms = tf_sec * 1000
    buckets: Dict[int, List[float]] = {}
    for t in sorted(ticks, key=lambda x: int(x.get("t") or 0)):
        ts = int(t.get("t") or 0)
        pct = t.get("pct")
        if pct is None:
            continue
        try:
            val = float(pct)
        except (TypeError, ValueError):
            continue
        if val != val:  # NaN
            continue
        b = (ts // tf_ms) * tf_ms
        buckets.setdefault(b, []).append(val)
    candles: List[Dict[str, Any]] = []
    for b in sorted(buckets.keys()):
        vals = buckets[b]
        if not vals:
            continue
        o = vals[0]
        c = vals[-1]
        h = max(vals)
        l = min(vals)
        candles.append(
            {
                "t": int(b // 1000),
                "o": o,
                "h": h,
                "l": l,
                "c": c,
            }
        )
    return candles


def get_candles(row_id: str, col_id: str, tf: str) -> Dict[str, Any]:
    ticks = _filter_ticks(row_id, col_id)
    candles = ticks_to_candles(ticks, tf)
    label = ""
    for p in all_spread_pairs():
        if p["row"] == row_id and p["col"] == col_id:
            label = p["label"]
            break
    if not label and ticks:
        label = f"{ticks[0].get('rowEx', row_id)} → {ticks[0].get('colEx', col_id)}"
    return {
        "ok": True,
        "row": row_id,
        "col": col_id,
        "tf": tf,
        "label": label,
        "formula": "(列 ÷ 行 − 1) × 100%",
        "tickCount": len(ticks),
        "candles": candles,
    }


def history_meta() -> Dict[str, Any]:
    with _lock:
        n = len(_ticks)
        first = int(_ticks[0]["t"]) if _ticks else None
        last = int(_ticks[-1]["t"]) if _ticks else None
    return {
        "ok": True,
        "tickCount": n,
        "pairCount": EXPECTED_SPREAD_PAIRS,
        "pairsWithData": _pairs_with_data(),
        "firstTs": first,
        "lastTs": last,
        "formula": "(列 ÷ 行 − 1) × 100%",
    }
