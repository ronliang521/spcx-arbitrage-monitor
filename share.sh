#!/usr/bin/env bash
# 把本机 8080 通过 Cloudflare 临时隧道暴露到公网（HTTPS），发给他人即可访问。
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "请先安装 cloudflared："
  echo "  brew install cloudflare/cloudflare/cloudflared"
  exit 1
fi

OLD_PID="$(lsof -tiTCP:8080 -sTCP:LISTEN 2>/dev/null || true)"
if [[ -z "${OLD_PID}" ]]; then
  echo "8080 未监听，正在后台启动 server.py …"
  HOST=127.0.0.1 PORT=8080 nohup python3 server.py >/tmp/spcx-arb.log 2>&1 &
  sleep 2
fi

# 避免走 HTTP 代理；Clash/Surge TUN 仍可能劫持，见下方提示
unset http_proxy https_proxy ALL_PROXY HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY

CFG="${PWD}/share-tunnel-min.yml"

echo ""
echo "正在创建公网隧道（关闭本窗口即断开）…"
echo ""
echo "若出现 TLS handshake / 198.18.0.x 错误："
echo "  → 先关掉 Clash/Surge 的「增强模式 / TUN」，或把 cloudflared 设为直连，再重跑本脚本。"
echo ""

exec cloudflared tunnel \
  --config "${CFG}" \
  --protocol quic \
  --url "http://127.0.0.1:8080"
