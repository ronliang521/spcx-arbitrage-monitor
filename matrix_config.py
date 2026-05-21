"""价差矩阵行列定义（监控页与历史页共用）。"""

MATRIX_COLS = ["gate", "bitget", "mexc", "binance", "okx", "tradexyz", "aster"]

MATRIX_COL_LABELS = {
    "gate": "Gate",
    "bitget": "Bitget",
    "mexc": "MEXC",
    "binance": "Binance",
    "okx": "OKX",
    "tradexyz": "trade.xyz",
    "aster": "Aster",
}

# 矩阵行顺序（与 server.VENUES 一致）
ROW_VENUE_IDS = ["binance", "okx", "bitget", "gate", "mexc", "aster", "tradexyz"]

ROW_VENUE_LABELS = {
    "binance": "Binance",
    "okx": "OKX",
    "bitget": "Bitget",
    "gate": "Gate",
    "mexc": "MEXC",
    "aster": "Aster",
    "tradexyz": "trade.xyz",
}

EXPECTED_SPREAD_PAIRS = len(ROW_VENUE_IDS) * len(MATRIX_COLS) - len(ROW_VENUE_IDS)

# 与 server.VENUES[].type 一致：现货 / 永续合约
VENUE_MARKET_TYPE: dict[str, str] = {
    "binance": "永续合约",
    "okx": "永续合约",
    "bitget": "现货",
    "gate": "现货",
    "mexc": "现货",
    "aster": "永续合约",
    "tradexyz": "永续合约",
}


def market_type_meta(venue_id: str) -> dict[str, str]:
    """返回矩阵标注用：type 原文、typeShort 现货/合约、typeKind spot|futures。"""
    raw = VENUE_MARKET_TYPE.get(venue_id, "")
    if raw == "现货":
        return {"type": raw, "typeShort": "现货", "typeKind": "spot"}
    if raw == "永续合约":
        return {"type": raw, "typeShort": "合约", "typeKind": "futures"}
    return {"type": raw, "typeShort": raw or "—", "typeKind": "futures"}
