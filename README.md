# SPCX · SpaceX 多市场套利监控（网页）

在浏览器中查看 **7 个市场** 的 SpaceX / SPCX 实时行情与隐含估值价差矩阵。

## 一键打开网页

```bash
cd spcx-arbitrage-monitor
pip3 install -r requirements.txt   # 首次
./start.sh
```

浏览器访问：

- 套利监控：**http://127.0.0.1:8080**
- 价差历史 K 线：**http://127.0.0.1:8080/history.html**

或：

```bash
python3 server.py
```

## 页面内容

1. **实时数据表**：代币、类型、交易所、股份、价格、隐含估值、24H 成交额  
2. **价差矩阵**：行=各所标的，列=Gate / Bitget / MEXC / 币安 / OKX / trade.xyz / Aster（价差 %）  
3. **价差历史数据**：自动落盘矩阵 42 组方向，每组一张 K 线（1m / 5m / 15m / 1h）

历史数据在 `data/spread_ticks.ndjson`，需保持 `server.py` 运行且监控页在轮询 `/api/quote` 才会持续写入。

## 让别人 / 外网访问

详见 **[docs/公网访问.md](docs/公网访问.md)**。最快做法：

```bash
./start.sh          # 终端 A
./share.sh          # 终端 B → 复制 https://xxx.trycloudflare.com 发给别人
```

局域网：`HOST=0.0.0.0 PORT=8080 python3 server.py`，他人访问 `http://你的局域网IP:8080`。
