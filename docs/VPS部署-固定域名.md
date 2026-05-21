# 云服务器 24h 部署 SPCX 套利监控（固定域名）

适用：阿里云 / 腾讯云 / AWS 等 Linux VPS（示例用 **Ubuntu 22.04**）。

推荐架构：**VPS 跑 Python** + **Cloudflare 隧道/反代** 提供 `https://你的域名`。  
你已有 `lumigzs.com` + Cloudflare 时，用 **方案 A** 最省事。

---

## 第 0 步：在控制台记下这些信息

在云厂商控制台找到：

| 项目 | 示例 |
|------|------|
| 公网 IP | `123.45.67.89` |
| 系统 | Ubuntu 22.04 |
| SSH 用户 | `root` 或 `ubuntu` |
| SSH 密码或密钥 | 登录用 |

**安全组 / 防火墙** 先放行：

- **22**（SSH，必开）
- 若用 Cloudflare 隧道：**不必**对公网开放 8080
- 若用 Nginx 直连：**80、443**

---

## 第 1 步：Mac 上 SSH 登录服务器

```bash
ssh root@你的公网IP
```

首次会问 `yes/no`，输入 `yes`。输入密码或用密钥登录。

登录成功后提示符类似 `root@xxx:~#`。

---

## 第 2 步：安装基础环境（在服务器上执行）

```bash
apt update
apt install -y python3 python3-pip python3-venv git rsync
mkdir -p /opt/spcx-arbitrage-monitor
```

---

## 第 3 步：把项目拷到服务器

任选一种。

### 方式 A：Mac 用 rsync（未推 GitHub 时推荐）

在 **Mac 本机** 新开终端（不要 SSH 里）：

```bash
rsync -avz --exclude node_modules --exclude data --exclude .git \
  /Users/ronliang/Documents/cursor/spcx-arbitrage-monitor/ \
  root@你的公网IP:/opt/spcx-arbitrage-monitor/
```

把 `root@你的公网IP` 换成你的用户和 IP。

### 方式 B：GitHub clone（已 push 后）

在 **服务器** 上：

```bash
cd /opt
git clone https://github.com/你的用户名/spcx-arbitrage-monitor.git
```

---

## 第 4 步：安装 Python 依赖并试跑

在 **服务器** 上：

```bash
cd /opt/spcx-arbitrage-monitor
pip3 install -r requirements.txt
mkdir -p data
HOST=0.0.0.0 PORT=8080 python3 server.py
```

另开 SSH 窗口测试：

```bash
curl -s http://127.0.0.1:8080/api/quote | head -c 200
```

能看到 JSON 就说明服务正常。回到跑 `server.py` 的窗口按 **Ctrl+C** 停掉，下面用 systemd 常驻。

---

## 第 5 步：开机自启（systemd）

```bash
cp /opt/spcx-arbitrage-monitor/deploy/spcx-arbitrage.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable spcx-arbitrage
systemctl start spcx-arbitrage
systemctl status spcx-arbitrage
```

应显示 `active (running)`。

日志：

```bash
journalctl -u spcx-arbitrage -f
```

---

## 第 6 步：固定域名（二选一）

### 方案 A：Cloudflare Tunnel（推荐，已有 lumigzs.com）

**注意：** 同一个隧道 ID **只能在一台机器上跑**。若 Mac 上还在跑 `cloudflared`，要先停 Mac 上的，改到 VPS 跑。

1. **Mac** 安装包传到服务器（在 Mac 执行）：

```bash
scp -r ~/.cloudflared root@你的公网IP:/root/.cloudflared
```

2. **服务器** 安装 cloudflared：

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
```

3. 编辑 `/root/.cloudflared/config.yml`，在 `ingress:` 里**增加一条**（放在 `http_status:404` 上面）：

```yaml
  - hostname: spcx.lumigzs.com
    service: http://127.0.0.1:8080
```

保留你原来的 `spacex.lumigzs.com` → `8767` 等规则。

4. **Cloudflare 控制台** → 域名 `lumigzs.com` → DNS → 添加记录：

   - 类型 **CNAME**
   - 名称 **spcx**
   - 目标 **隧道 ID 对应的目标**（与 `spacex` 子域相同方式，或 Tunnel 页面一键添加）

5. **服务器** 启动隧道并开机自启：

```bash
cloudflared tunnel run 04e1e6a6-65e2-47e1-8c85-ffaa6454f65d
```

确认无误后：

```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
```

6. 浏览器访问：**https://spcx.lumigzs.com**  
   历史页：**https://spcx.lumigzs.com/history.html**

---

### 方案 B：Nginx + HTTPS（公网 IP + 域名 A 记录）

1. 域名 DNS：**A 记录** → 服务器公网 IP  
2. 服务器：

```bash
apt install -y nginx certbot python3-certbot-nginx
```

3. 新建 `/etc/nginx/sites-available/spcx`：

```nginx
server {
    listen 80;
    server_name spcx.你的域名.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

4. 启用并申请证书：

```bash
ln -s /etc/nginx/sites-available/spcx /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d spcx.你的域名.com
```

---

## 第 7 步：数据会不会保存？

| 内容 | 位置 |
|------|------|
| 价差历史 | `/opt/spcx-arbitrage-monitor/data/spread_ticks.ndjson` |
| 何时写入 | 有人打开监控页，约每 5 秒一条 |
| 备份 | 定期 `scp` 或快照整个 `data/` 目录 |

```bash
# 服务器上看历史文件大小
ls -lh /opt/spcx-arbitrage-monitor/data/
```

**VPS 一直开机 + `spcx-arbitrage` 服务 running** → 数据会持续积累。  
换机器时把 `data/` 目录一起迁过去。

---

## 第 8 步：给别人用的链接

- 监控：`https://spcx.lumigzs.com/`（换成你的域名）
- 历史：`https://spcx.lumigzs.com/history.html`

无需他们装任何东西。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| `systemctl status` 失败 | `journalctl -u spcx-arbitrage -n 50` 看报错 |
| 页面无数据 | 云厂商安全组是否拦出站；`curl` 交易所 API 是否通 |
| 域名 502 | `systemctl status spcx-arbitrage`；隧道是否指向 `8080` |
| Mac 和 VPS 同时跑同一隧道 | 只保留 **一台** 上的 `cloudflared` |

---

## 更新代码后重启

```bash
cd /opt/spcx-arbitrage-monitor
# git pull 或 rsync 覆盖后
systemctl restart spcx-arbitrage
```
