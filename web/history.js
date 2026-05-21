const THEME_KEY = "spcx_arb_theme";
const REFRESH_MS = 12_000;
const EXPECTED_PAIRS = 42;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const TF_OPTIONS = ["1m", "5m", "15m", "1h"];
let pairsCatalog = [];
let blocksInitialized = false;
let searchQuery = "";
/** @type {Map<string, { chart: any, series: any, el: HTMLElement }>} */
const chartMap = new Map();

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  setTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
}

function chartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#eef2f8";
}

const VENUE_DISPLAY_ALIASES = { 币安: "Binance" };

function normalizeVenueName(name) {
  const s = String(name || "").trim();
  return VENUE_DISPLAY_ALIASES[s] || s;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 板块标题：label 为「行所 → 列所」，前者买方、后者卖方。 */
function pairLegs(pair) {
  let buyName = "";
  let sellName = "";
  if (pair.label && pair.label.includes("→")) {
    const parts = pair.label.split(/\s*→\s*/).map((s) => s.trim());
    buyName = parts[0] || "";
    sellName = parts[1] || "";
  }
  if (!buyName) buyName = pair.row || "";
  if (!sellName) sellName = pair.col || "";
  return { buyName: normalizeVenueName(buyName), sellName: normalizeVenueName(sellName) };
}

function pairTitleHtml(pair) {
  const { buyName, sellName } = pairLegs(pair);
  return `<span class="pair-leg pair-leg-buy"><span class="pair-leg-name">${escapeHtml(buyName)}</span><span class="pair-leg-role">买方</span></span><span class="pair-arrow" aria-hidden="true">→</span><span class="pair-leg pair-leg-sell"><span class="pair-leg-name">${escapeHtml(sellName)}</span><span class="pair-leg-role">卖方</span></span>`;
}

function pairSearchText(pair) {
  const { buyName, sellName } = pairLegs(pair);
  return `${pair.label} ${buyName} ${sellName} 买方 卖方 ${pair.row} ${pair.col} ${pair.key}`.toLowerCase();
}

function getBlockTf(block) {
  return block?.dataset?.tf || "1m";
}

function blockTfButtonsHtml(activeTf = "1m") {
  return TF_OPTIONS.map(
    (tf) =>
      `<button type="button" class="block-tf-btn${tf === activeTf ? " active" : ""}" data-tf="${tf}">${tf}</button>`
  ).join("");
}

function pairFromBlock(block) {
  const found = pairsCatalog.find((x) => x.key === block.dataset.pair);
  if (found) return found;
  const [row, col] = (block.dataset.pair || "").split("|");
  const buyName = block.querySelector(".pair-leg-buy .pair-leg-name")?.textContent?.trim() || "";
  const sellName = block.querySelector(".pair-leg-sell .pair-leg-name")?.textContent?.trim() || "";
  const label = buyName && sellName ? `${buyName} → ${sellName}` : "";
  return { key: block.dataset.pair, row, col, label };
}

/** 去重、升序、过滤非法 OHLC，供 Lightweight Charts 使用（time 为 UTC 秒）。 */
function sanitizeCandles(raw) {
  const map = new Map();
  for (const c of raw || []) {
    const time = Number(c.t ?? c.time);
    if (!Number.isFinite(time) || time <= 0) continue;
    const open = Number(c.o ?? c.open);
    const high = Number(c.h ?? c.high);
    const low = Number(c.l ?? c.low);
    const close = Number(c.c ?? c.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    map.set(time, { time, open, high, low, close });
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function setBlockChartError(block, message) {
  const summary = block.querySelector(".pair-block-summary");
  if (!summary) return;
  let err = block.querySelector("[data-chart-err]");
  if (!message) {
    err?.remove();
    return;
  }
  if (!err) {
    err = document.createElement("span");
    err.className = "pair-block-err mono";
    err.dataset.chartErr = "1";
    summary.appendChild(err);
  }
  err.textContent = message;
}

function applySearchFilter() {
  const q = searchQuery.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll(".pair-block").forEach((block) => {
    const text = block.dataset.search || "";
    const match = !q || text.includes(q);
    block.hidden = !match;
    if (match) visible += 1;
  });
  const total = pairsCatalog.length || EXPECTED_PAIRS;
  $("#search-count").textContent = q ? String(visible) : String(total);
}

function createChart(el) {
  if (!window.LightweightCharts) return null;
  const w = Math.max(el.clientWidth || el.parentElement?.clientWidth || 600, 280);
  const chart = window.LightweightCharts.createChart(el, {
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: chartTextColor(),
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.06)" },
      horzLines: { color: "rgba(255,255,255,0.06)" },
    },
    rightPriceScale: { borderVisible: false },
    timeScale: { timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    width: w,
    height: 220,
  });
  const series = chart.addCandlestickSeries({
    upColor: "#34d399",
    downColor: "#fb7185",
    borderUpColor: "#34d399",
    borderDownColor: "#fb7185",
    wickUpColor: "#34d399",
    wickDownColor: "#fb7185",
    priceFormat: { type: "custom", formatter: (p) => `${p.toFixed(2)}%` },
  });
  return { chart, series };
}

function initChartForBlock(block) {
  const key = block.dataset.pair;
  if (!key || chartMap.has(key)) return chartMap.get(key);
  if (!window.LightweightCharts) return null;
  const box = block.querySelector("[data-chart]");
  if (!box) return null;
  const empty = block.querySelector("[data-empty]");
  if (empty) empty.remove();
  const inst = createChart(box);
  if (inst) {
    chartMap.set(key, { ...inst, el: box });
    block.dataset.chartReady = "1";
  }
  return inst;
}

function ensureBlock(pair, index) {
  const list = $("#blocks-list");
  let block = list.querySelector(`[data-pair="${pair.key}"]`);
  if (block) return block;

  block = document.createElement("details");
  block.className = "pair-block panel";
  block.dataset.pair = pair.key;
  block.dataset.search = pairSearchText(pair);
  block.dataset.index = String(index + 1);
  block.dataset.tf = "1m";
  block.innerHTML = `
    <summary class="pair-block-summary">
      <span class="pair-block-index mono">${index + 1}</span>
      <span class="pair-block-title">${pairTitleHtml(pair)}</span>
      <span class="pair-chevron" aria-hidden="true">▼</span>
    </summary>
    <div class="pair-block-body">
      <div class="block-toolbar">
        <span class="block-toolbar-label">K 线周期</span>
        <div class="segmented block-tf-group" role="group" aria-label="K线周期">${blockTfButtonsHtml("1m")}</div>
      </div>
      <div class="chart-box" data-chart>
        <p class="chart-empty" data-empty>暂无 K 线，请保持监控页运行以积累价差</p>
      </div>
    </div>
  `;

  block.addEventListener("toggle", () => {
    if (!block.open) return;
    requestAnimationFrame(() => {
      const inst = initChartForBlock(block);
      if (inst?.chart && inst.el) {
        inst.chart.applyOptions({ width: Math.max(inst.el.clientWidth, 280) });
      }
      refreshBlockData(block, pairFromBlock(block));
    });
  });

  block.querySelector(".block-tf-group")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".block-tf-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const tf = btn.dataset.tf || "1m";
    block.dataset.tf = tf;
    block.querySelectorAll(".block-tf-btn").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    refreshBlockData(block, pairFromBlock(block));
  });

  list.appendChild(block);
  return block;
}

function initBlocksList(pairs) {
  const list = $("#blocks-list");
  list.innerHTML = "";
  chartMap.clear();
  pairs.forEach((pair, i) => ensureBlock(pair, i));
  blocksInitialized = true;
  $("#charts-count").textContent = `${pairs.length} 个板块`;
  applySearchFilter();
}

async function loadPairCandles(pair, tf) {
  const url = `/api/spread-history/candles?row=${encodeURIComponent(pair.row)}&col=${encodeURIComponent(pair.col)}&tf=${encodeURIComponent(tf)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (data.ok === false) throw new Error(data.error || "candles failed");
  return data;
}

async function refreshBlockData(block, pair) {
  const key = pair.key || block.dataset.pair;
  const tf = getBlockTf(block);
  try {
    const data = await loadPairCandles(pair, tf);
    const candles = sanitizeCandles(data.candles);
    setBlockChartError(block, "");

    const emptyEl = block.querySelector("[data-empty]");
    if (emptyEl) {
      emptyEl.hidden = candles.length > 0;
      if (!candles.length) {
        emptyEl.textContent =
          data.tickCount > 0
            ? "该周期暂无 K 线，可切换更短周期"
            : "暂无 K 线，请保持监控页运行以积累价差";
      }
    }

    if (block.open) {
      if (!window.LightweightCharts) {
        setBlockChartError(block, "K线库未加载");
        return;
      }
      const inst = chartMap.get(key) || initChartForBlock(block);
      if (inst?.series) {
        if (candles.length) {
          inst.series.setData(candles);
          inst.chart.timeScale().fitContent();
        } else {
          inst.series.setData([]);
        }
      } else if (!inst) {
        setBlockChartError(block, "图表初始化失败");
      }
    }
    block.dataset.lastClose = candles.length ? String(candles[candles.length - 1].close) : "";
  } catch (e) {
    setBlockChartError(block, e.message || "加载失败");
  }
}

async function renderAll() {
  const banner = $("#err-banner");
  if (!window.LightweightCharts) {
    banner.hidden = false;
    banner.textContent =
      "K 线绘图库未加载。请强制刷新（Cmd+Shift+R）；若仍失败，检查网络或代理是否拦截 /vendor/ 静态资源。";
  }
  try {
    const [metaR, pairsR] = await Promise.all([
      fetch("/api/spread-history/meta", { cache: "no-store" }),
      fetch("/api/spread-history/pairs", { cache: "no-store" }),
    ]);
    if (!metaR.ok || !pairsR.ok) {
      throw new Error(`HTTP ${metaR.status}/${pairsR.status}`);
    }
    const meta = await metaR.json();
    const pairsData = await pairsR.json();
    const pairs = pairsData.pairs || [];
    pairsCatalog = pairs;

    if (!blocksInitialized || $("#blocks-list").querySelectorAll(".pair-block").length !== pairs.length) {
      initBlocksList(pairs);
    }

    if (meta.firstTs && meta.lastTs) {
      const a = new Date(meta.firstTs).toLocaleString("zh-CN", { hour12: false });
      const b = new Date(meta.lastTs).toLocaleString("zh-CN", { hour12: false });
      const withData = meta.pairsWithData ?? "—";
      $("#hist-meta").textContent = `${meta.tickCount} 点 · 有数据 ${withData}/${EXPECTED_PAIRS} 组 · ${a} ~ ${b}`;
    } else {
      $("#hist-meta").textContent = `0 点 · 请打开监控页并保持 server 运行以写入 42 组价差`;
    }

    if (window.LightweightCharts) {
      await Promise.all(
        pairs.map(async (pair) => {
          const block = document.querySelector(`[data-pair="${pair.key}"]`);
          if (!block) return;
          if (block.open || block.dataset.chartReady === "1") {
            if (block.open && !chartMap.has(pair.key)) initChartForBlock(block);
            await refreshBlockData(block, pair);
          }
        })
      );
      if (pairs.length) banner.hidden = true;
    }

    applySearchFilter();
  } catch (e) {
    banner.hidden = false;
    banner.textContent = `加载失败：${e.message}`;
  }
}

function onResize() {
  chartMap.forEach(({ chart, el }) => {
    if (el?.clientWidth) chart.applyOptions({ width: Math.max(el.clientWidth, 280) });
  });
}

function setAllBlocksOpen(open) {
  document.querySelectorAll(".pair-block").forEach((block) => {
    if (block.hidden) return;
    block.open = open;
    if (open) initChartForBlock(block);
  });
  if (open) {
    pairsCatalog.forEach((pair) => {
      const block = document.querySelector(`[data-pair="${pair.key}"]`);
      if (block?.open) refreshBlockData(block, pair);
    });
  }
}

function boot() {
  initTheme();
  renderAll();
  setInterval(renderAll, REFRESH_MS);
  window.addEventListener("resize", onResize);
}

$("#pair-search")?.addEventListener("input", (e) => {
  searchQuery = e.target.value || "";
  applySearchFilter();
});

$("#btn-expand-all")?.addEventListener("click", () => setAllBlocksOpen(true));
$("#btn-collapse-all")?.addEventListener("click", () => setAllBlocksOpen(false));

$("#btn-refresh")?.addEventListener("click", renderAll);
$("#btn-theme")?.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  chartMap.forEach(({ chart }) => {
    chart.applyOptions({ layout: { textColor: chartTextColor() } });
  });
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
