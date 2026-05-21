# 绑定固定域名 spcx.lumigzs.com（VPS + Cloudflare 隧道）

前提：VPS 上 `spcx-arbitrage` 已 `active`，`curl http://127.0.0.1:8080/api/quote` 有 JSON。

**重要：** 同一隧道 ID 只能在一台机器上跑 `cloudflared`。改到 VPS 后，请 **关闭 Mac 上** 的 `cloudflared`（否则 `spacex.lumigzs.com` 等若在 Mac 跑会冲突）。

---

## 第 1 步：Mac 上传隧道配置（Mac 终端）

```bash
scp -r -i ~/.ssh/id_ed25519 ~/.cloudflared root@154.3.36.238:/root/.cloudflared
```

---

## 第 2 步：Mac 停掉本机隧道（若有）

活动监视器里退出 `cloudflared`，或 Mac 终端：

```bash
pkill -f cloudflared || true
```

---

## 第 3 步：VPS 安装 cloudflared（SSH root 里）

```bash
ssh -i ~/.ssh/id_ed25519 root@154.3.36.238
```

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
```

---

## 第 4 步：改 VPS 上的 config.yml

```bash
cp /root/.cloudflared/config.yml /root/.cloudflared/config.yml.bak
nano /root/.cloudflared/config.yml
```

在 `ingress:` 里、最后的 `http_status:404` **上面** 增加（或参考 `deploy/cloudflared-config-vps.yml.example`）：

```yaml
  - hostname: spcx.lumigzs.com
    service: http://127.0.0.1:8080
```

保存退出。

---

## 第 5 步：Cloudflare 加公网主机名

任选一种：

### A. Zero Trust（推荐）

1. https://one.dash.cloudflare.com → **Networks → Tunnels**
2. 选隧道 `04e1e6a6-65e2-47e1-8c85-ffaa6454f65d`
3. **Public Hostname → Add**
   - Subdomain: `spcx`
   - Domain: `lumigzs.com`
   - Service: `http://127.0.0.1:8080`

### B. DNS 手动

域名 **lumigzs.com** → DNS → CNAME：

- 名称：`spcx`
- 目标：与 `spacex` 子域相同（隧道页面的 CNAME 目标）

---

## 第 6 步：VPS 启动隧道服务

```bash
cloudflared service install
systemctl daemon-reload
systemctl enable cloudflared
systemctl restart cloudflared
systemctl status cloudflared
systemctl status spcx-arbitrage
```

---

## 第 7 步：验证

VPS：

```bash
curl -s http://127.0.0.1:8080/api/quote | head -c 200
```

浏览器（手机 4G 更好）：

- https://spcx.lumigzs.com/
- https://spcx.lumigzs.com/history.html

---

## 发给别人的链接

| 页面 | 地址 |
|------|------|
| 套利监控 | https://spcx.lumigzs.com/ |
| 价差历史 | https://spcx.lumigzs.com/history.html |
