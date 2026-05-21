const POLL_MS = 5000;
const THEME_KEY = "spcx_arb_theme";

const $ = (sel) => document.querySelector(sel);

function fmtTs(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  setTheme(saved === "light" ? "light" : "dark");
}

function cellClass(pct) {
  if (pct == null || Number.isNaN(pct)) return "cell-muted";
  if (Math.abs(pct) < 0.05) return "cell-muted";
  return pct > 0 ? "cell-up" : "cell-down";
}

function renderMarkets(markets) {
  const tbody = $("#markets-body");
  if (!markets?.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading">无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = markets
    .map((m) => {
      const typeCls = m.type === "现货" ? "spot" : "futures";
      const err = m.error ? `<span class="cell-down" title="${m.error}">获取失败</span>` : "";
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
        <td>${m.exchange}</td>
        <td>
          <span class="mono">${m.sharesDisplay}</span>
          <span class="shares-sub">${m.sharesNote}</span>
        </td>
        <td>${price}</td>
        <td class="mono">${m.impliedDisplay ?? "—"}</td>
        <td class="mono">${m.volume24hDisplay ?? "—"}</td>
        <td>${links}</td>
      </tr>`;
    })
    .join("");
}

function renderSpreadMatrix(spread, tab) {
  const block = tab === "raw" ? spread?.rawPrice : spread;
  const head = $("#spread-head");
  const body = $("#spread-body");
  const note = $("#spread-note");
  if (!block) return;
  note.textContent = block.note || spread?.note || "";

  const cols = block.columns || [];
  head.innerHTML = `<tr>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;

  const rows = block.rows || [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${cols.length}" class="loading">无数据</td></tr>`;
    return;
  }

  const colKeys = cols.map((c) => c.key).filter((k) => k !== "token");

  body.innerHTML = rows
    .map((row) => {
      const tokenCell = `<td><strong>${row.exchange}</strong><br><code style="font-size:0.8em">${row.token}</code></td>`;
      const dataCells = colKeys
        .map((colId) => {
          const cell = row.cells?.[colId] ?? {};
          const self = cell.self === true;
          const cls = self ? "matrix-self" : cellClass(cell.pct);
          const title =
            tab === "impl" && !self && cell.colImpl != null
              ? `title="列隐含 ${cell.colImpl.toExponential?.(3) ?? cell.colImpl}"`
              : "";
          return `<td class="${cls}" ${title}>${cell.label ?? "—"}</td>`;
        })
        .join("");
      return `<tr>${tokenCell}${dataCells}</tr>`;
    })
    .join("");
}

let activeTab = "impl";
let lastPayload = null;

async function fetchQuote() {
  const status = $("#fetch-status");
  status.textContent = "刷新中…";
  status.className = "status-pill warn";
  try {
    const r = await fetch("/api/quote", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    lastPayload = data;
    $("#last-updated").textContent = fmtTs(data.ts);
    renderMarkets(data.markets);
    renderSpreadMatrix(data.spread, activeTab);

    const errs = (data.markets || []).filter((m) => m.error).length;
    status.textContent = errs ? `${errs} 路异常` : "正常";
    status.className = errs ? "status-pill warn" : "status-pill ok";

    const banner = $("#err-banner");
    if (errs === (data.markets || []).length) {
      banner.hidden = false;
      banner.textContent = "所有行情源暂时不可用，请稍后重试。";
    } else if (errs > 0) {
      banner.hidden = false;
      banner.textContent = `部分交易所行情拉取失败（${errs} 路），表格中已标注。`;
    } else {
      banner.hidden = true;
    }
  } catch (e) {
    status.textContent = "失败";
    status.className = "status-pill warn";
    const banner = $("#err-banner");
    banner.hidden = false;
    banner.textContent = `拉取失败：${e.message}`;
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    activeTab = btn.dataset.tab || "impl";
    if (lastPayload?.spread) renderSpreadMatrix(lastPayload.spread, activeTab);
  });
});

$("#btn-refresh")?.addEventListener("click", () => fetchQuote());
$("#btn-theme")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(next);
});

initTheme();
fetchQuote();
setInterval(fetchQuote, POLL_MS);
