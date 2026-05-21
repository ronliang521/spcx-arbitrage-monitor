const POLL_MS = 5000;
const THEME_KEY = "spcx_arb_theme";
const SORT_KEY = "spcx_arb_markets_sort";

const $ = (sel) => document.querySelector(sel);

/** @type {{ key: string, dir: 'asc'|'desc' } | null} */
let marketsSort = { key: "volume24h", dir: "desc" };
/** @type {unknown[] | null} */
let lastMarkets = null;
/** @type {Set<string>} */
let openSharesPanels = new Set();

function fmtTs(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  setTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
}

function loadSortPref() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p && (p.key === "type" || p.key === "volume24h") && (p.dir === "asc" || p.dir === "desc")) {
      marketsSort = p;
    }
  } catch {
    /* ignore */
  }
}

function saveSortPref() {
  if (marketsSort) localStorage.setItem(SORT_KEY, JSON.stringify(marketsSort));
}

function cellClass(pct) {
  if (pct == null || Number.isNaN(pct)) return "cell-muted";
  if (Math.abs(pct) < 0.05) return "cell-muted";
  return pct > 0 ? "cell-up" : "cell-down";
}

const TYPE_ORDER = { 现货: 0, 永续合约: 1 };

function sortMarkets(list) {
  if (!marketsSort || !list?.length) return list ?? [];
  const { key, dir } = marketsSort;
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (key === "type") {
      const ta = TYPE_ORDER[a.type] ?? 9;
      const tb = TYPE_ORDER[b.type] ?? 9;
      if (ta !== tb) return (ta - tb) * sign;
      return String(a.exchange).localeCompare(String(b.exchange), "zh");
    }
    if (key === "volume24h") {
      const va = a.volume24h;
      const vb = b.volume24h;
      const na = va == null || Number.isNaN(va);
      const nb = vb == null || Number.isNaN(vb);
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (va !== vb) return (va - vb) * sign;
      return String(a.exchange).localeCompare(String(b.exchange), "zh");
    }
    return 0;
  });
}

function updateSortHeaders() {
  document.querySelectorAll(".th-sort").forEach((btn) => {
    const k = btn.dataset.sort;
    const active = marketsSort?.key === k;
    btn.classList.toggle("active", active);
    const ind = btn.querySelector(".sort-indicator");
    if (!ind) return;
    if (!active) {
      ind.textContent = "↕";
      return;
    }
    ind.textContent = marketsSort.dir === "asc" ? "↑" : "↓";
  });
}

function renderSharesCell(m) {
  if (!m.sharesExpandable || !m.sharesFormula) {
    return `<span class="mono">${m.sharesDisplay}</span><span class="shares-sub">${m.sharesNote}</span>`;
  }
  const id = `shares-${m.id}`;
  const open = openSharesPanels.has(m.id);
  return `<div class="shares-cell">
    <button type="button" class="shares-toggle${open ? " open" : ""}" aria-expanded="${open}" aria-controls="${id}" data-target="${id}" data-venue="${m.id}">
      <span class="mono">${m.sharesDisplay}</span>
      <span class="shares-chevron" aria-hidden="true">▼</span>
    </button>
    <div id="${id}" class="shares-detail" ${open ? "" : "hidden"}>
      <code class="shares-formula">${m.sharesFormula}</code>
      <span class="shares-sub">${m.sharesNote}</span>
    </div>
  </div>`;
}

function bindSharesToggles(root) {
  root.querySelectorAll(".shares-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.dataset.target);
      const vid = btn.dataset.venue;
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("open", open);
      if (vid) {
        if (open) openSharesPanels.add(vid);
        else openSharesPanels.delete(vid);
      }
    });
  });
}

function renderHighlights(items) {
  const sec = $("#highlights-section");
  const box = $("#highlights");
  if (!items?.length) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  box.innerHTML = items
    .map((h) => {
      const cls = cellClass(h.pct);
      return `<div class="highlight-card">
        <div class="${cls} pct mono">${h.pct >= 0 ? "+" : ""}${h.pct.toFixed(2)}%</div>
        <div>${h.from} → ${h.to}</div>
      </div>`;
    })
    .join("");
}

function renderMarkets(markets) {
  const tbody = $("#markets-body");
  const rows = sortMarkets(markets);
  updateSortHeaders();

  if (!rows?.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading">无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((m) => {
      const typeCls = m.type === "现货" ? "spot" : "futures";
      const err = m.error ? `<span class="cell-down" title="${m.error}">失败</span>` : "";
      const price = m.error ? err : `<span class="mono">${m.priceDisplay ?? "—"}</span>`;
      const links = [
        `<a href="${m.tradeUrl}" target="_blank" rel="noopener">交易</a>`,
        m.announceUrl
          ? `<a href="${m.announceUrl}" target="_blank" rel="noopener">公告</a>`
          : `<span class="cell-muted">—</span>`,
      ].join(" · ");
      return `<tr>
        <td><code>${m.token}</code></td>
        <td><span class="tag ${typeCls}">${m.type}</span></td>
        <td><strong>${m.exchange}</strong></td>
        <td>${renderSharesCell(m)}</td>
        <td>${price}</td>
        <td class="mono">${m.impliedDisplay ?? "—"}</td>
        <td class="mono">${m.volume24hDisplay ?? "—"}</td>
        <td>${links}</td>
      </tr>`;
    })
    .join("");
  bindSharesToggles(tbody);
}

function alignMatrixSellerBand() {
  const band = document.getElementById("matrix-seller-band");
  const table = document.getElementById("spread-table");
  if (!band || !table) return;

  const headRow = table.querySelector("#spread-head tr");
  if (!headRow) {
    band.hidden = true;
    return;
  }

  const cells = headRow.querySelectorAll("th");
  if (cells.length < 3) {
    band.hidden = true;
    return;
  }

  const firstMarket = cells[2];
  const lastMarket = cells[cells.length - 1];
  const scroll = table.closest(".matrix-scroll");
  if (!scroll) return;

  const sr = scroll.getBoundingClientRect();
  const a = firstMarket.getBoundingClientRect();
  const b = lastMarket.getBoundingClientRect();
  const left = a.left - sr.left + scroll.scrollLeft;
  const width = b.right - a.left;

  band.style.left = `${left}px`;
  band.style.width = `${Math.max(width, 0)}px`;
  band.hidden = width < 8;
}

function renderSpreadMatrix(spread) {
  const head = $("#spread-head");
  const body = $("#spread-body");
  const band = document.getElementById("matrix-seller-band");
  if (!spread) return;

  const cols = spread.columns || [];
  const marketCols = cols.filter((c) => c.key !== "token");
  const colKeys = marketCols.map((c) => c.key);
  const labelByKey = Object.fromEntries(marketCols.map((c) => [c.key, c.label]));
  const totalColCount = colKeys.length + 2;

  const sellerHeaderCells = colKeys
    .map((key) => `<th>${labelByKey[key]}</th>`)
    .join("");

  head.innerHTML = `
    <tr>
      <th class="matrix-head-spacer-buyer" aria-hidden="true"></th>
      <th class="matrix-row-axis"></th>
      ${sellerHeaderCells}
    </tr>`;

  const rows = spread.rows || [];

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${totalColCount}" class="loading">无数据</td></tr>`;
    if (band) band.hidden = true;
    return;
  }

  function dataCell(row, colId) {
    const cell = row.cells?.[colId] ?? {};
    const self = cell.self === true;
    const cls = self ? "matrix-self" : cellClass(cell.pct);
    return `<td class="${cls}">${cell.label ?? "—"}</td>`;
  }

  body.innerHTML = rows
    .map((row, idx) => {
      const rowLabel = `<td class="matrix-row-label"><strong>${row.exchange}</strong><br><code style="font-size:0.78em">${row.token}</code></td>`;
      const dataCells = colKeys.map((colId) => dataCell(row, colId)).join("");
      const buyerAxis =
        idx === 0
          ? `<td rowspan="${rows.length}" class="matrix-axis-buyer-body">买方</td>`
          : "";
      return `<tr>${buyerAxis}${rowLabel}${dataCells}</tr>`;
    })
    .join("");

  requestAnimationFrame(() => {
    alignMatrixSellerBand();
    requestAnimationFrame(alignMatrixSellerBand);
  });
}

if (!window.__matrixSellerBandResize) {
  window.__matrixSellerBandResize = true;
  window.addEventListener("resize", () => alignMatrixSellerBand());
  document.querySelector(".matrix-scroll")?.addEventListener("scroll", () => alignMatrixSellerBand(), {
    passive: true,
  });
}

async function fetchQuote() {
  const status = $("#fetch-status");
  status.textContent = "刷新中…";
  status.className = "status-pill warn";
  try {
    const r = await fetch("/api/quote", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    $("#last-updated").textContent = fmtTs(data.ts);
    const rev = data.configRevision;
    if (rev != null && rev < 3) {
      const banner = $("#err-banner");
      banner.hidden = false;
      banner.textContent =
        "后端仍是旧进程（configRevision=" +
        rev +
        "）。请在终端 Ctrl+C 后重新执行 ./start.sh。";
    }
    renderHighlights(data.highlights);
    lastMarkets = data.markets;
    renderMarkets(lastMarkets);
    renderSpreadMatrix(data.spread);

    const errs = (data.markets || []).filter((m) => m.error).length;
    status.textContent = errs ? `${errs} 路异常` : "正常";
    status.className = errs ? "status-pill warn" : "status-pill ok";

    const banner = $("#err-banner");
    if (errs === (data.markets || []).length) {
      banner.hidden = false;
      banner.textContent = "所有行情源暂时不可用，请稍后重试。";
    } else if (errs > 0) {
      banner.hidden = false;
      banner.textContent = `部分行情拉取失败（${errs} 路）。`;
    } else if (rev == null || rev >= 3) {
      banner.hidden = true;
    }
  } catch (e) {
    status.textContent = "失败";
    status.className = "status-pill warn";
    const banner = $("#err-banner");
    banner.hidden = false;
    banner.textContent = `拉取失败：${e.message}（请先运行 python3 server.py）`;
  }
}

document.querySelectorAll(".th-sort").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.sort;
    if (!key) return;
    if (marketsSort?.key === key) {
      marketsSort = { key, dir: marketsSort.dir === "asc" ? "desc" : "asc" };
    } else {
      marketsSort = { key, dir: key === "volume24h" ? "desc" : "asc" };
    }
    saveSortPref();
    if (lastMarkets) renderMarkets(lastMarkets);
  });
});

$("#btn-refresh")?.addEventListener("click", fetchQuote);
$("#btn-theme")?.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

loadSortPref();
initTheme();
updateSortHeaders();
fetchQuote();
setInterval(fetchQuote, POLL_MS);
