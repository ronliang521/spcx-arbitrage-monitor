#!/usr/bin/env bash
# 从 GitHub 拉取最新 main 到默认 VPS 并重启服务
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_HOST="${DEPLOY_SSH_HOST:-root@154.3.36.238}"
APP_DIR="${DEPLOY_APP_DIR:-/opt/spcx-arbitrage-monitor}"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> Deploy ${BRANCH} -> ${SSH_HOST}:${APP_DIR}"

ssh -i "$SSH_KEY" -o ConnectTimeout=20 "$SSH_HOST" bash -s <<REMOTE
set -euo pipefail
cd "${APP_DIR}"
if [ ! -d .git ]; then
  echo "ERROR: ${APP_DIR} is not a git repo" >&2
  exit 1
fi
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt
cp deploy/spcx-arbitrage.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable spcx-arbitrage
systemctl restart spcx-arbitrage
systemctl is-active spcx-arbitrage
curl -sf http://127.0.0.1:8080/api/quote | head -c 80
echo ""
echo "OK: deployed $(git rev-parse --short HEAD)"
REMOTE

echo "==> Done. Public: https://spcx.lumigzs.com/"
