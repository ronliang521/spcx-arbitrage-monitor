"""Bark 价差提醒：矩阵方向筛选 + 阈值 + Bark 链接推送。"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from urllib.parse import quote, urlparse

import requests

DEFAULT_TITLE = "SPCX 价差提醒"

_bark_session = requests.Session()


def normalize_bark_url(value: Any) -> str:
    """规范为设备推送根地址：https://api.day.app/<key>/"""
    if not isinstance(value, str):
        return ""
    s = value.strip()
    if not s:
        return ""
    if not s.startswith("http://") and not s.startswith("https://"):
        s = f"https://api.day.app/{s.strip('/')}"
    try:
        u = urlparse(s)
        host = (u.netloc or "").lower()
        if "day.app" not in host:
            return ""
        segs = [x for x in (u.path or "/").split("/") if x.strip()]
        if not segs:
            return ""
        key = segs[0].replace("/", "").strip()
        if not key:
            return ""
        return f"https://api.day.app/{key}/"
    except Exception:
        return ""


def mask_bark_url(url: str) -> str:
    base = normalize_bark_url(url)
    if not base:
        return ""
    key = base.rstrip("/").split("/")[-1]
    if len(key) <= 6:
        return "••••"
    return f"••••{key[-4:]}"


@dataclass
class BarkBinding:
    id: str
    name: str
    url: str
    enabled: bool = True

    def to_public(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "urlMask": mask_bark_url(self.url),
            "enabled": self.enabled,
            "hasUrl": bool(normalize_bark_url(self.url)),
        }


@dataclass
class BarkConfig:
    enabled: bool = False
    watch_pairs: List[str] = field(default_factory=list)
    threshold_pct: float = 1.0
    cooldown_seconds: int = 120
    title: str = DEFAULT_TITLE
    bindings: List[BarkBinding] = field(default_factory=list)

    def watch_pair_set(self) -> Set[str]:
        return {p for p in self.watch_pairs if isinstance(p, str) and "|" in p}

    def active_urls(self) -> List[str]:
        out: List[str] = []
        seen: Set[str] = set()
        for b in self.bindings:
            if not b.enabled:
                continue
            u = normalize_bark_url(b.url)
            if not u or u in seen:
                continue
            seen.add(u)
            out.append(u)
        return out

    def to_public(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "watchPairs": list(self.watch_pairs),
            "watchPairCount": len(self.watch_pairs),
            "thresholdPct": self.threshold_pct,
            "cooldownSeconds": self.cooldown_seconds,
            "title": self.title,
            "bindings": [b.to_public() for b in self.bindings],
            "activeBindingCount": len(self.active_urls()),
        }


def _default_config() -> BarkConfig:
    return BarkConfig()


def _parse_bindings(raw: Any) -> List[BarkBinding]:
    if not isinstance(raw, list):
        return []
    out: List[BarkBinding] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        bid = str(item.get("id") or item.get("bindingId") or f"binding-{i}").strip()
        if not bid:
            bid = f"binding-{i}"
        name = str(item.get("name") or "").strip() or f"同事{i + 1}"
        url_raw = item.get("url") or item.get("key") or item.get("barkUrl") or ""
        url = normalize_bark_url(url_raw)
        enabled = bool(item.get("enabled", True))
        out.append(BarkBinding(id=bid, name=name, url=url, enabled=enabled))
    return out


def _parse_watch_pairs(raw: Any, valid_keys: Optional[Set[str]] = None) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for item in raw:
        s = str(item).strip()
        if not s or "|" not in s or s in seen:
            continue
        if valid_keys is not None and s not in valid_keys:
            continue
        seen.add(s)
        out.append(s)
    return out


def load_bark_config(path: Path, *, valid_pair_keys: Optional[Set[str]] = None) -> BarkConfig:
    if not path.exists():
        return _default_config()
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return _default_config()
    if not isinstance(raw, dict):
        return _default_config()

    watch = _parse_watch_pairs(raw.get("watch_pairs", raw.get("watchPairs")), valid_pair_keys)
    if not watch and isinstance(raw.get("events"), list):
        watch = []

    try:
        threshold = float(raw.get("threshold_pct", raw.get("thresholdPct", 1.0)))
    except (TypeError, ValueError):
        threshold = 1.0
    if threshold < 0:
        threshold = 0.0
    elif "spread_min_abs_pct" in raw or "spreadMinAbsPct" in raw:
        try:
            legacy = float(raw.get("spread_min_abs_pct", raw.get("spreadMinAbsPct", threshold)))
            threshold = max(threshold, legacy)
        except (TypeError, ValueError):
            pass

    try:
        cooldown = int(raw.get("cooldown_seconds", raw.get("cooldownSeconds", 120)))
    except (TypeError, ValueError):
        cooldown = 120
    cooldown = max(30, cooldown)

    cfg = BarkConfig(
        enabled=bool(raw.get("enabled")),
        watch_pairs=watch,
        threshold_pct=threshold,
        cooldown_seconds=cooldown,
        title=str(raw.get("title") or DEFAULT_TITLE).strip() or DEFAULT_TITLE,
        bindings=_parse_bindings(raw.get("bindings")),
    )
    if cfg.enabled and (not cfg.active_urls() or not cfg.watch_pairs):
        cfg.enabled = False
    return cfg


def save_bark_config(path: Path, cfg: BarkConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "enabled": cfg.enabled,
        "watch_pairs": list(cfg.watch_pairs),
        "threshold_pct": cfg.threshold_pct,
        "cooldown_seconds": cfg.cooldown_seconds,
        "title": cfg.title,
        "bindings": [
            {
                "id": b.id,
                "name": b.name,
                "url": normalize_bark_url(b.url),
                "enabled": b.enabled,
            }
            for b in cfg.bindings
        ],
    }
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def merge_config_update(
    current: BarkConfig,
    payload: Dict[str, Any],
    *,
    valid_pair_keys: Optional[Set[str]] = None,
) -> BarkConfig:
    cfg = BarkConfig(
        enabled=bool(payload.get("enabled", current.enabled)),
        watch_pairs=list(current.watch_pairs),
        threshold_pct=current.threshold_pct,
        cooldown_seconds=current.cooldown_seconds,
        title=current.title,
        bindings=list(current.bindings),
    )

    if isinstance(payload.get("watchPairs"), list):
        wp = _parse_watch_pairs(payload["watchPairs"], valid_pair_keys)
        if wp:
            cfg.watch_pairs = wp
        elif payload.get("watchPairs") == []:
            cfg.watch_pairs = []

    if payload.get("thresholdPct") is not None:
        try:
            cfg.threshold_pct = max(0.0, float(payload["thresholdPct"]))
        except (TypeError, ValueError):
            pass

    if payload.get("cooldownSeconds") is not None:
        try:
            cfg.cooldown_seconds = max(30, int(payload["cooldownSeconds"]))
        except (TypeError, ValueError):
            pass

    if payload.get("title"):
        cfg.title = str(payload["title"]).strip() or DEFAULT_TITLE

    if isinstance(payload.get("bindings"), list):
        merged: List[BarkBinding] = []
        for i, item in enumerate(payload["bindings"]):
            if not isinstance(item, dict):
                continue
            bid = str(item.get("id") or f"binding-{i}").strip()
            old = next((b for b in current.bindings if b.id == bid), None)
            name = str(item.get("name") or (old.name if old else "")).strip() or f"同事{i + 1}"
            url_in = item.get("url") or item.get("barkUrl") or item.get("key")
            if url_in is not None and str(url_in).strip():
                url = normalize_bark_url(url_in)
            elif old:
                url = old.url
            else:
                url = ""
            enabled = bool(item.get("enabled", old.enabled if old else True))
            merged.append(BarkBinding(id=bid, name=name, url=url, enabled=enabled))
        cfg.bindings = merged

    if cfg.enabled and (not cfg.active_urls() or not cfg.watch_pairs):
        cfg.enabled = False
    return cfg


def evaluate_spread_hits(
    spread: Dict[str, Any],
    cfg: BarkConfig,
    *,
    col_labels: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """仅监控已选矩阵方向，且 |价差%| ≥ 阈值。"""
    if not cfg.enabled or not cfg.watch_pairs:
        return []
    watch = cfg.watch_pair_set()
    threshold = float(cfg.threshold_pct)
    rows = spread.get("rows") or []
    hits: List[Dict[str, Any]] = []

    for row in rows:
        row_id = row.get("id")
        row_ex = row.get("exchange") or row_id
        cells = row.get("cells") or {}
        for col_id, cell in cells.items():
            if cell.get("self"):
                continue
            pair_key = f"{row_id}|{col_id}"
            if pair_key not in watch:
                continue
            pct = cell.get("pct")
            if pct is None:
                continue
            try:
                v = float(pct)
            except (TypeError, ValueError):
                continue
            if abs(v) < threshold:
                continue
            col_ex = (col_labels or {}).get(col_id, col_id)
            hits.append(
                {
                    "pairKey": pair_key,
                    "row": row_id,
                    "col": col_id,
                    "from": row_ex,
                    "to": col_ex,
                    "pct": v,
                    "label": f"{row_ex} → {col_ex}: {v:+.2f}%",
                }
            )
    hits.sort(key=lambda x: abs(x["pct"]), reverse=True)
    return hits


def bark_push_url(
    device_url: str,
    title: str,
    body: str,
    *,
    sound: str = "alarm",
    level: str = "critical",
) -> None:
    base = normalize_bark_url(device_url)
    if not base:
        raise ValueError("invalid_bark_url")
    safe_title = quote(title or "", safe="")
    safe_body = quote(body or "", safe="")
    endpoint = f"{base.rstrip('/')}/{safe_title}/{safe_body}"
    params = {"sound": sound, "level": level, "volume": "10", "call": "1"}
    r = _bark_session.get(endpoint, params=params, timeout=12)
    r.raise_for_status()


def push_to_bindings(
    cfg: BarkConfig,
    *,
    title: str,
    body: str,
    urls: Optional[List[str]] = None,
) -> Dict[str, Any]:
    target = urls or cfg.active_urls()
    if not target:
        return {"ok": False, "error": "no_urls", "sent": 0}
    sent = 0
    errors: List[str] = []
    for raw in target:
        u = normalize_bark_url(raw)
        if not u:
            continue
        try:
            bark_push_url(u, title, body)
            sent += 1
        except Exception as e:
            errors.append(f"{mask_bark_url(u)}: {e}")
    return {"ok": sent > 0, "sent": sent, "errors": errors}


# 兼容旧 import
def normalize_bark_key(value: Any) -> str:
    base = normalize_bark_url(value)
    if not base:
        return ""
    return base.rstrip("/").split("/")[-1]
