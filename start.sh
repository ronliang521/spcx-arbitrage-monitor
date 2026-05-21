#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "安装依赖…"
  pip3 install -r requirements.txt
fi

# 若 8080 已有旧版 server.py，先结束（仅杀本机 LISTEN 的 Python）
OLD_PID="$(lsof -tiTCP:8080 -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "${OLD_PID}" ]]; then
  echo "结束旧进程 PID ${OLD_PID}（否则仍会返回旧股本口径）"
  kill "${OLD_PID}" 2>/dev/null || true
  sleep 1
fi

echo "启动网页 http://127.0.0.1:8080"
echo "确认版本：打开 http://127.0.0.1:8080/api/bark/config 应返回 ok:true（含 Bark 提醒）"
exec python3 server.py
