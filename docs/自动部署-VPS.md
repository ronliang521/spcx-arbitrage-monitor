# 自动部署到默认 VPS

默认服务器：`root@154.3.36.238`，路径 `/opt/spcx-arbitrage-monitor`，公网 https://spcx.lumigzs.com/

## 方式 A：本机 push 后自动部署（推荐）

一次性安装 Git 钩子：

```bash
cd /Users/ronliang/Documents/cursor/spcx-arbitrage-monitor
chmod +x deploy/deploy-vps.sh deploy/install-git-hook.sh
./deploy/install-git-hook.sh
```

之后每次在本机执行 **`git push`**，钩子会自动运行 `deploy/deploy-vps.sh`（SSH 拉代码 + 重启服务）。

手动部署（不 push 也可）：

```bash
./deploy/deploy-vps.sh
```

## 方式 B：GitHub Actions（任意电脑 push 都部署）

仓库内已有 `.github/workflows/deploy-vps.yml`（若尚未进 GitHub，需用带 **workflow** 权限的账号 push 该文件）。

1. GitHub 仓库 → **Settings → Secrets → Actions**
2. 新建 **`VPS_SSH_PRIVATE_KEY`**：填入 Mac 上 `~/.ssh/id_ed25519` 的**私钥**全文（与 DMIT 面板 mac-new 对应）
3. 向 **`main`** 分支 `git push` 后，Actions 会自动 SSH 部署

若 push 报错 `without workflow scope`：在 GitHub 重新授权 Cursor/gh CLI 的 **workflow** 权限，或在本机用 SSH remote push。

## 日常流程

```bash
git add -A && git commit -m "your message"
git push    # 触发 A 或 B，VPS 更新
```

注意：仅改本地文件、不 commit / push 不会上云；需要先提交并推到 GitHub。
