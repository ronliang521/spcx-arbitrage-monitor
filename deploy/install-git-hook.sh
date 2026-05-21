#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_SRC="${ROOT}/deploy/git-hooks/post-push"
HOOK_DST="${ROOT}/.git/hooks/post-push"
cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST" "${ROOT}/deploy/deploy-vps.sh"
echo "Installed post-push hook -> ${HOOK_DST}"
echo "After each 'git push', VPS will auto-deploy via deploy/deploy-vps.sh"
