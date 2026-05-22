/**
 * SPCX / SpaceX 多市场套利监控 — Cloudflare Worker
 * 聚合 Binance / OKX / Bitget / Gate / MEXC / Aster / trade.xyz 公开行情
 */

export interface Env {
  ASSETS: Fetcher;
}

const UPSTREAM_TIMEOUT_MS = 8000;

type VenueId =
  | "binance"
  | "okx"
  | "bitget"
  | "gate"
  | "mexc"
  | "aster"
  | "tradexyz";

interface VenueConfig {
  id: VenueId;
  exchange: string;
  token: string;
  type: "永续合约" | "现货";
  shares: number;
  sharesNote: string;
  sharesFormula?: string;
  impliedValuationNote: string;
  tradeUrl: string;
  announceUrl: string | null;
  symbol: string;
}

const VENUES: VenueConfig[] = [
  {
    id: "binance",
    exchange: "Binance",
    token: "SPCXUSDT",
    type: "永续合约",
    shares: 11_870_000_000,
    sharesNote: "118.7 亿股（公告口径）",
    impliedValuationNote: "价格 × 118.7 亿股",
    tradeUrl: "https://www.binance.com/zh-CN/futures/SPCXUSDT",
    announceUrl:
      "https://www.binance.com/zh-CN/support/announcement/detail/4a9484ee10b347d287f514ee3fdd6a29",
    symbol: "SPCXUSDT",
  },
  {
    id: "okx",
    exchange: "OKX",
    token: "SPACEX-USDT-SWAP",
    type: "永续合约",
    shares: 1_000_000_000,
    sharesNote: "10 亿股 = 1,000,000,000（OKX Pre-IPO 公告预估股本）",
    impliedValuationNote: "价格 × 10 亿股",
    tradeUrl: "https://www.okx.com/zh-hans/trade-swap/spacex-usdt-swap",
    announceUrl:
      "https://www.okx.com/zh-hans/help/okx-to-list-pre-ipo-pre-market-perpetual-futures-for-spacex-usdt-openai-usdt-and-anthropic-usdt",
    symbol: "SPACEX-USDT-SWAP",
  },
  {
    id: "bitget",
    exchange: "Bitget",
    token: "PRESPAXUSDT",
    type: "现货",
    shares: 1_500_000_000_000 / 650,
    sharesNote: "隐含估值 $1.5T，认购价 $650",
    sharesFormula: "1500000000000/650",
    impliedValuationNote: "SpaceX 隐含估值 $1.5T（IPO Prime）",
    tradeUrl: "https://www.bitget.com/zh-CN/spot/PRESPAXUSDT",
    announceUrl: "https://www.bitget.com/zh-CN/support/articles/12560603882368",
    symbol: "PRESPAXUSDT",
  },
  {
    id: "gate",
    exchange: "Gate",
    token: "SPCX_USDT",
    type: "现货",
    shares: 1_400_000_000_000 / 118,
    sharesNote: "1:5 拆股后 · 隐含市值 $1.4T，认购价口径 $118（原 $590÷5）",
    sharesFormula: "1400000000000/118",
    impliedValuationNote: "SpaceX 隐含市值 $1.4T（Gate 公告 51314，1:5 拆股）",
    tradeUrl: "https://www.gate.com/zh/trade/SPCX_USDT",
    announceUrl: "https://www.gate.com/zh/announcements/article/51314",
    symbol: "SPCX_USDT",
  },
  {
    id: "mexc",
    exchange: "MEXC",
    token: "SPACEX(PRE)USDT",
    type: "现货",
    shares: 1_500_000_000_000 / 650,
    sharesNote: "隐含实体估值 $1.5T，认购价 $650",
    sharesFormula: "1500000000000/650",
    impliedValuationNote: "价格 × 股本（公告）",
    tradeUrl:
      "https://www.mexc.com/zh-MY/exchange/SPACEX(PRE)_USDT?_from=search_spot_trade",
    announceUrl:
      "https://www.mexc.com/zh-MY/announcements/article/spacex-pre-launchpad-17827791535416",
    symbol: "SPACEX(PRE)USDT",
  },
  {
    id: "aster",
    exchange: "Aster",
    token: "SPCXUSDT",
    type: "永续合约",
    shares: 11_870_000_000,
    sharesNote: "118.7 亿股（与 Binance 口径对齐）",
    impliedValuationNote: "价格 × 118.7 亿股",
    tradeUrl: "https://www.asterdex.com/zh-CN/trade/pro/futures/SPCXUSDT",
    announceUrl: null,
    symbol: "SPCXUSDT",
  },
  {
    id: "tradexyz",
    exchange: "trade.xyz",
    token: "xyz:SPCX",
    type: "永续合约",
    shares: 11_870_000_000,
    sharesNote: "118.7 亿股（与 Binance 口径对齐）",
    impliedValuationNote: "价格 × 118.7 亿股",
    tradeUrl: "https://app.trade.xyz/?market=SPCX",
    announceUrl: null,
    symbol: "xyz:SPCX",
  },
];

/** 价差矩阵列顺序（与 Ron 需求一致） */
const MATRIX_COLS: VenueId[] = [
  "gate",
  "bitget",
  "mexc",
  "binance",
  "okx",
  "tradexyz",
  "aster",
];

const MATRIX_COL_LABELS: Record<VenueId, string> = {
  gate: "Gate",
  bitget: "Bitget",
  mexc: "MEXC",
  binance: "币安",
  okx: "OKX",
  tradexyz: "trade.xyz",
  aster: "Aster",
};

let quoteCache: { atMs: number; payload: Record<string, unknown> } | null = null;
const QUOTE_CACHE_TTL_MS = 1200;

function nowMs(): number {
  return Date.now();
}

function asFloat(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(3)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtVol(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtSharesDisplay(shares: number, venueId: VenueId): string {
  if (venueId === "okx") return "10 亿股";
  if (venueId === "binance" || venueId === "aster" || venueId === "tradexyz") return "118.7 亿股";
  const yi = shares / 100_000_000;
  if (yi >= 1) return `${parseFloat(yi.toPrecision(4))} 亿股`;
  return `${shares.toLocaleString("en-US")} 股`;
}

function spreadPct(fromImpl: number | null, toImpl: number | null): number | null {
  if (fromImpl == null || toImpl == null || fromImpl <= 0) return null;
  return ((toImpl - fromImpl) / fromImpl) * 100;
}

interface QuoteRow {
  id: VenueId;
  token: string;
  type: string;
  exchange: string;
  shares: number;
  sharesNote: string;
  price: number | null;
  impliedValuation: number | null;
  volume24h: number | null;
  tradeUrl: string;
  announceUrl: string | null;
  error: string | null;
  updatedAt: number | null;
}

async function fetchBinance(): Promise<Partial<QuoteRow>> {
  const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=SPCXUSDT`;
  const r = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!r.ok) return { error: `http_${r.status}` };
  const d = (await r.json()) as Record<string, unknown>;
  const last = asFloat(d.lastPrice);
  const vol = asFloat(d.quoteVolume);
  return { price: last, volume24h: vol, updatedAt: asFloat(d.closeTime) };
}

async function fetchOkx(): Promise<Partial<QuoteRow>> {
  const url = `https://www.okx.com/api/v5/market/ticker?instId=SPACEX-USDT-SWAP`;
  const r = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!r.ok) return { error: `http_${r.status}` };
  const payload = (await r.json()) as Record<string, unknown>;
  const data = payload.data;
  if (!Array.isArray(data) || !data.length) return { error: "empty" };
  const row = data[0] as Record<string, unknown>;
  const last = asFloat(row.last);
  const volBase = asFloat(row.volCcy24h);
  const quoteVol =
    volBase != null && last != null ? volBase * last : null;
  return { price: last, volume24h: quoteVol, updatedAt: asFloat(row.ts) };
}

async function fetchGate(): Promise<Partial<QuoteRow>> {
  const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=SPCX_USDT`;
  const r = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!r.ok) return { error: `http_${r.status}` };
  const data = (await r.json()) as unknown;
  if (!Array.isArray(data) || !data.length) return { error: "empty" };
  const row = data[0] as Record<string, unknown>;
  return {
    price: asFloat(row.last),
    volume24h: asFloat(row.quote_volume),
    updatedAt: nowMs(),
  };
}

async function fetchBitget(): Promise<Partial<QuoteRow>> {
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    referer: "https://www.bitget.com/zh-CN/spot/PRESPAXUSDT",
    origin: "https://www.bitget.com",
  };
  const tickerUrl = `https://api.bitget.com/api/v2/spot/market/tickers?symbol=PRESPAXUSDT`;
  try {
    const r = await fetch(tickerUrl, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers,
    });
    if (r.ok) {
      const payload = (await r.json()) as Record<string, unknown>;
      const data = payload.data;
      if (Array.isArray(data) && data.length) {
        const row = data[0] as Record<string, unknown>;
        return {
          price: asFloat(row.lastPr),
          volume24h: asFloat(row.quoteVolume) ?? asFloat(row.usdtVolume),
          updatedAt: asFloat(row.ts),
        };
      }
    }
    const fillsUrl = `https://api.bitget.com/api/v2/spot/market/fills?symbol=PRESPAXUSDT&limit=1`;
    const r2 = await fetch(fillsUrl, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers });
    if (!r2.ok) return { error: `http_${r2.status}` };
    const p2 = (await r2.json()) as Record<string, unknown>;
    const fills = p2.data;
    if (!Array.isArray(fills) || !fills.length) return { error: "empty" };
    const row = fills[0] as Record<string, unknown>;
    return { price: asFloat(row.price), volume24h: null, updatedAt: asFloat(row.ts) };
  } catch (e) {
    return { error: e instanceof Error ? e.name : "fetch_error" };
  }
}

async function fetchMexc(): Promise<Partial<QuoteRow>> {
  const url = `https://api.mexc.com/api/v3/ticker/24hr?symbol=SPACEX(PRE)USDT`;
  const r = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!r.ok) return { error: `http_${r.status}` };
  const d = (await r.json()) as Record<string, unknown>;
  return {
    price: asFloat(d.lastPrice),
    volume24h: asFloat(d.quoteVolume),
    updatedAt: nowMs(),
  };
}

async function fetchAster(): Promise<Partial<QuoteRow>> {
  const url = `https://fapi.asterdex.com/fapi/v3/ticker/24hr?symbol=SPCXUSDT`;
  const r = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!r.ok) return { error: `http_${r.status}` };
  const d = (await r.json()) as Record<string, unknown>;
  return {
    price: asFloat(d.lastPrice),
    volume24h: asFloat(d.quoteVolume),
    updatedAt: asFloat(d.closeTime),
  };
}

async function fetchTradexyz(): Promise<Partial<QuoteRow>> {
  const body = JSON.stringify({ type: "metaAndAssetCtxs", dex: "xyz" });
  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!r.ok) return { error: `http_${r.status}` };
  const raw = (await r.json()) as unknown;
  if (!Array.isArray(raw) || raw.length < 2) return { error: "empty" };
  const meta = raw[0] as { universe?: { name?: string }[] };
  const ctxs = raw[1] as Record<string, unknown>[];
  const universe = meta.universe ?? [];
  let idx = -1;
  for (let i = 0; i < universe.length; i++) {
    if (universe[i]?.name === "xyz:SPCX") {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    const midsR = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids", dex: "xyz" }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const mids = (await midsR.json()) as Record<string, string>;
    const mid = asFloat(mids["xyz:SPCX"]);
    return { price: mid, volume24h: null, updatedAt: nowMs() };
  }
  const ctx = ctxs[idx] ?? {};
  const mark = asFloat(ctx.markPx) ?? asFloat(ctx.midPx);
  const vol = asFloat(ctx.dayNtlVlm);
  return { price: mark, volume24h: vol, updatedAt: nowMs() };
}

async function fetchVenueQuote(cfg: VenueConfig): Promise<QuoteRow> {
  const fetchers: Record<VenueId, () => Promise<Partial<QuoteRow>>> = {
    binance: fetchBinance,
    okx: fetchOkx,
    bitget: fetchBitget,
    gate: fetchGate,
    mexc: fetchMexc,
    aster: fetchAster,
    tradexyz: fetchTradexyz,
  };
  let partial: Partial<QuoteRow> = { error: "unknown" };
  try {
    partial = await fetchers[cfg.id]();
  } catch (e) {
    partial = { error: e instanceof Error ? e.name : "fetch_error" };
  }
  const price = partial.price ?? null;
  const implied = price != null ? price * cfg.shares : null;
  return {
    id: cfg.id,
    token: cfg.token,
    type: cfg.type,
    exchange: cfg.exchange,
    shares: cfg.shares,
    sharesNote: cfg.sharesNote,
    price,
    impliedValuation: implied,
    volume24h: partial.volume24h ?? null,
    tradeUrl: cfg.tradeUrl,
    announceUrl: cfg.announceUrl,
    error: partial.error ?? null,
    updatedAt: partial.updatedAt ?? null,
  };
}

async function buildSnapshot(): Promise<Record<string, unknown>> {
  const results = await Promise.all(VENUES.map((v) => fetchVenueQuote(v)));
  const byId = Object.fromEntries(results.map((r) => [r.id, r])) as Record<VenueId, QuoteRow>;

  const markets = results.map((r) => {
    const cfg = VENUES.find((v) => v.id === r.id)!;
    return {
      ...r,
      impliedValuationNote: cfg.impliedValuationNote,
      priceDisplay: fmtPrice(r.price),
      impliedDisplay: fmtUsd(r.impliedValuation),
      volume24hDisplay: fmtVol(r.volume24h),
      sharesDisplay: fmtSharesDisplay(r.shares, r.id as VenueId),
      sharesFormula: cfg.sharesFormula ?? null,
      sharesExpandable: Boolean(cfg.sharesFormula),
    };
  });

  const rowIds = VENUES.map((v) => v.id);
  const matrixRows: Record<string, unknown>[] = [];

  for (const rowId of rowIds) {
    const row = byId[rowId];
    const rowImpl = row?.impliedValuation ?? null;
    const cells: Record<string, unknown> = {};
    for (const colId of MATRIX_COLS) {
      if (colId === rowId) {
        cells[colId] = { pct: 0, label: "—", self: true };
        continue;
      }
      const col = byId[colId];
      const pct = spreadPct(rowImpl, col?.impliedValuation ?? null);
      cells[colId] = {
        pct,
        label: pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        colPrice: col?.price ?? null,
        colImpl: col?.impliedValuation ?? null,
      };
    }
    matrixRows.push({
      id: rowId,
      token: row?.token ?? rowId,
      exchange: row?.exchange ?? rowId,
      rowPrice: row?.price ?? null,
      rowImpl,
      rowImplDisplay: fmtUsd(rowImpl),
      cells,
    });
  }

  const highlights: Record<string, unknown>[] = [];
  for (const row of matrixRows) {
    for (const colId of MATRIX_COLS) {
      const cell = (row.cells as Record<string, unknown>)[colId] as Record<string, unknown>;
      if (cell?.self) continue;
      const pct = cell?.pct as number | null;
      if (pct == null) continue;
      highlights.push({
        from: row.exchange,
        to: MATRIX_COL_LABELS[colId],
        pct,
      });
    }
  }
  highlights.sort((a, b) => Math.abs(b.pct as number) - Math.abs(a.pct as number));

  return {
    ok: true,
    ts: nowMs(),
    markets,
    highlights: highlights.slice(0, 6),
    spread: {
      note: "隐含估值差 = (列估值 − 行估值) / 行估值。合约与现货报价单位不同，请用此表套利。",
      columns: [{ key: "token", label: "代币" }, ...MATRIX_COLS.map((id) => ({ key: id, label: MATRIX_COL_LABELS[id] }))],
      rows: matrixRows,
    },
    venues: VENUES,
  };
}

async function handleApiQuote(): Promise<Response> {
  const t = nowMs();
  if (quoteCache && t - quoteCache.atMs < QUOTE_CACHE_TTL_MS) {
    return Response.json(quoteCache.payload, {
      headers: { "Cache-Control": "public, max-age=1" },
    });
  }
  const payload = await buildSnapshot();
  quoteCache = { atMs: t, payload };
  return Response.json(payload, { headers: { "Cache-Control": "public, max-age=1" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/quote") {
      return handleApiQuote();
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
