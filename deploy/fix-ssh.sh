#!/bin/bash
# Run on VPS (web console) as ubuntu after: mkdir -p ~/.ssh
set -euo pipefail
USER_HOME="${HOME:-/home/ubuntu}"
AUTH="${USER_HOME}/.ssh/authorized_keys"
mkdir -p "${USER_HOME}/.ssh"
chmod 700 "${USER_HOME}/.ssh"
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHxhNcA6r7V/rFRwoMy1eFEUU7MhYfDWmBg0PadZblKV ronliang@ronliangdeMac-mini.local'
grep -qF "${PUB}" "${AUTH}" 2>/dev/null || echo "${PUB}" >> "${AUTH}"
chmod 600 "${AUTH}"
echo "OK: SSH key installed for $(whoami)"
