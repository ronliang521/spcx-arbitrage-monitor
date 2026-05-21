"""价差矩阵行列定义（监控页与历史页共用）。"""

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
