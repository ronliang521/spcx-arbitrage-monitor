#!/usr/bin/env python3
"""从 spread_ticks.ndjson 移除指定交易所相关的 tick，便于拆股等口径变更后重积累。"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / "data" / "spread_ticks.ndjson"


def purge(path: Path, venue_id: str) -> tuple[int, int]:
    venue_id = venue_id.strip().lower()
    if not path.exists():
        return 0, 0
    kept: list[str] = []
    removed = 0
    total = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            total += 1
            try:
                tick = json.loads(s)
            except json.JSONDecodeError:
                kept.append(s)
                continue
            if tick.get("row") == venue_id or tick.get("col") == venue_id:
                removed += 1
                continue
            kept.append(s)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for s in kept:
            f.write(s + "\n")
    tmp.replace(path)
    return total, removed


def main() -> int:
    p = argparse.ArgumentParser(description="移除某交易所相关的价差历史 tick")
    p.add_argument("venue", help="交易所 id，如 gate")
    p.add_argument(
        "--path",
        type=Path,
        default=DEFAULT_PATH,
        help=f"ndjson 路径（默认 {DEFAULT_PATH}）",
    )
    args = p.parse_args()
    total, removed = purge(args.path, args.venue)
    kept = total - removed
    print(f"{args.path}: 共 {total} 行，移除 {removed}，保留 {kept}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
