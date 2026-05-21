/**
 * Bark 价差监控：价差历史 42 组方向 + |价差|≥阈值 + Bark 链接
 */
(function () {
  const COOLDOWN_LS = "spcx_bark_cooldown_ms";
  const BARK_LS_KEY = "spcx_bark_config_v2";
  const PAIRS_OPEN_LS = "spcx_bark_pairs_open";
  const PANEL_OPEN_LS = "spcx_bark_panel_open";
  const $ = (sel, root) => (root || document).querySelector(sel);

  let config = null;
  let matrixPairs = [];
  let bindingsDraft = [];
  let lastStatus = "—";
  let barkApiOk = false;

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function defaultConfig() {
    return {
      enabled: false,
      watchPairs: [],
      thresholdPct: 1,
      cooldownSeconds: 120,
      title: "SPCX 价差提醒",
      bindings: [],
      activeBindingCount: 0,
    };
  }

  function readLocalConfig() {
    try {
      const raw = localStorage.getItem(BARK_LS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && typeof p === "object" ? p : null;
    } catch {
      return null;
    }
  }

  function writeLocalConfig(cfg) {
    localStorage.setItem(BARK_LS_KEY, JSON.stringify(cfg));
  }

  function loadCooldownMap() {
    try {
      return JSON.parse(localStorage.getItem(COOLDOWN_LS) || "{}") || {};
    } catch {
      return {};
    }
  }

  function saveCooldownMap(map) {
    localStorage.setItem(COOLDOWN_LS, JSON.stringify(map));
  }

  function thresholdLabel(cfg) {
    const t = Number(cfg?.thresholdPct ?? 1);
    return `|价差| ≥ ${t.toFixed(2)}% 时提醒`;
  }

  /** Bark 通知标题：按命中数据生成，不读绑定备注名 */
  function spreadPushTitle(hits) {
    if (!hits?.length) return config?.title || "SPCX 价差提醒";
    if (hits.length === 1) {
      const h = hits[0];
      const from = h.from || h.row || "";
      const to = h.to || h.col || "";
      return `${from} → ${to} 有价差`;
    }
    return `${hits.length} 组交易对有价差`;
  }

  function spreadPushBody(hits) {
    const top = hits.slice(0, 5);
    const lines = top.map((h) => h.label).filter(Boolean);
    const more = hits.length > 5 ? `\n…共 ${hits.length} 组` : "";
    const t = Number(config?.thresholdPct ?? 1);
    return `${lines.join("\n")}${more}\n|价差| ≥ ${t.toFixed(2)}%`;
  }

  function watchPairsLabel(cfg) {
    const n = (cfg?.watchPairs || []).length;
    const total = matrixPairs.length || 42;
    if (!n) return "未选择方向";
    if (n === total) return `已选全部 ${n} 组`;
    return `已选 ${n} / ${total} 组`;
  }

  /** 与价差历史页相同的 42 组方向 */
  async function loadMatrixPairs() {
    const r = await fetch("/api/spread-history/pairs", { cache: "no-store" });
    if (!r.ok) throw new Error(`价差历史方向列表 HTTP ${r.status}`);
    const data = await r.json();
    matrixPairs = data.pairs || [];
    if (!matrixPairs.length) throw new Error("未获取到矩阵方向（0 组）");
  }

  function renderPairChips() {
    const box = $("#bark-pairs-chips");
    if (!box || !config) return;
    const active = new Set(config.watchPairs || []);
    if (!matrixPairs.length) {
      box.innerHTML = `<span class="cell-muted">加载 42 组方向…</span>`;
      return;
    }
    box.innerHTML = matrixPairs
      .map((p) => {
        const on = active.has(p.key);
        return `<button type="button" class="filter-chip filter-chip-pair${on ? " active" : ""}" data-pair="${escapeHtml(p.key)}" title="${escapeHtml(p.label)}" aria-pressed="${on}">${escapeHtml(p.label)}</button>`;
      })
      .join("");
  }

  function renderBindingsChips() {
    const box = $("#bark-bindings-chips");
    if (!box) return;
    const list = config?.bindings || [];
    if (!list.length) {
      box.innerHTML = `<span class="cell-muted">未绑定 Bark 链接</span>`;
      return;
    }
    box.innerHTML = list
      .map((b) => {
        const off = !b.enabled;
        const mask = b.urlMask || "—";
        const label = b.urlMask || b.name || "Bark";
        return `<span class="binding-chip${off ? " off" : ""}" title="${escapeHtml(label)}"><span class="mono binding-mask">${escapeHtml(label)}</span></span>`;
      })
      .join("");
  }

  function syncPairsCollapseHint() {
    const details = $("#bark-pairs-details");
    const hint = $("#bark-pairs-toggle-hint");
    if (!details || !hint) return;
    const open = details.open;
    hint.textContent = open ? "收起" : "展开";
    try {
      localStorage.setItem(PAIRS_OPEN_LS, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function syncPanelCollapseHint() {
    const details = $("#bark-panel-details");
    const hint = $("#bark-panel-toggle-hint");
    if (!details || !hint) return;
    hint.textContent = details.open ? "收起" : "展开";
    try {
      localStorage.setItem(PANEL_OPEN_LS, details.open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function initPanelCollapse() {
    const details = $("#bark-panel-details");
    if (!details) return;
    try {
      const saved = localStorage.getItem(PANEL_OPEN_LS);
      if (saved === "1") details.open = true;
      else if (saved === "0") details.open = false;
      else details.open = false;
    } catch {
      details.open = false;
    }
    syncPanelCollapseHint();
    details.addEventListener("toggle", syncPanelCollapseHint);

    const enableWrap = $("#bark-enable-switch-wrap");
    enableWrap?.addEventListener("click", (e) => e.stopPropagation());
  }

  function initPairsCollapse() {
    const details = $("#bark-pairs-details");
    if (!details) return;
    try {
      const saved = localStorage.getItem(PAIRS_OPEN_LS);
      if (saved === "1") details.open = true;
      else if (saved === "0") details.open = false;
      else details.open = false;
    } catch {
      details.open = false;
    }
    syncPairsCollapseHint();
    details.addEventListener("toggle", syncPairsCollapseHint);
  }

  function renderSummary() {
    if (!config) return;
    const enabled = $("#bark-enabled-toggle");
    if (enabled) enabled.checked = !!config.enabled;

    const pairsPill = $("#bark-pairs-pill");
    if (pairsPill) pairsPill.textContent = watchPairsLabel(config);
    syncPairsCollapseHint();

    const thPill = $("#bark-threshold-pill");
    if (thPill) thPill.textContent = thresholdLabel(config);

    renderPairChips();
    renderBindingsChips();

    const st = $("#bark-monitor-status");
    if (st) {
      const n = config.activeBindingCount ?? 0;
      const apiHint = barkApiOk ? "" : " · 配置仅本机缓存";
      if (!config.enabled) {
        const ready =
          n > 0 && (config.watchPairs?.length || 0) > 0
            ? `阈值 ${Number(config.thresholdPct ?? 1).toFixed(2)}% · ${n} 个 Bark 已绑定`
            : "请先绑定 Bark 并选择提醒方向";
        st.textContent = `监控未开启 — 请打开标题旁开关（服务端 7×24 推送） · ${ready}${apiHint}`;
      } else {
        st.textContent = `监控中 · ${n} 个 Bark${apiHint} · ${lastStatus}`;
      }
    }
  }

  /** 探测 /api/bark/config 是否可用（测试推送前会再试一次） */
  async function ensureBarkApi() {
    if (barkApiOk) return true;
    try {
      const r = await fetch("/api/bark/config", { cache: "no-store" });
      if (!r.ok) return false;
      const data = await r.json();
      config = data.config || config || defaultConfig();
      barkApiOk = true;
      writeLocalConfig(config);
      renderSummary();
      return true;
    } catch {
      return false;
    }
  }

  async function loadConfig() {
    await loadMatrixPairs();

    barkApiOk = false;
    try {
      const r = await fetch("/api/bark/config", { cache: "no-store" });
      if (r.status === 404) {
        throw new Error(
          "Bark API 不存在（404）。请在服务器拉取最新代码并重启 spcx-arbitrage 服务。"
        );
      }
      if (!r.ok) throw new Error(`Bark 配置 HTTP ${r.status}`);
      const data = await r.json();
      config = data.config || defaultConfig();
      barkApiOk = true;
      writeLocalConfig(config);
    } catch (e) {
      const local = readLocalConfig();
      if (local) {
        config = local;
        lastStatus = `${e.message}（已用本机缓存）`;
      } else {
        config = defaultConfig();
        if (matrixPairs.length) {
          config.watchPairs = matrixPairs.map((p) => p.key);
        }
        lastStatus = e.message;
      }
    }

    renderSummary();
    return config;
  }

  async function saveConfig(partial) {
    const next = { ...config, ...partial };
    if (partial.bindings) {
      next.bindings = partial.bindings;
      next.activeBindingCount = partial.bindings.filter(
        (b) => b.enabled && (b.hasUrl || b.urlMask)
      ).length;
    }

    if (barkApiOk || (await ensureBarkApi())) {
      const r = await fetch("/api/bark/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (r.status === 404) {
        barkApiOk = false;
      } else if (!r.ok) {
        throw new Error(`保存配置 HTTP ${r.status}`);
      } else {
        const data = await r.json();
        config = data.config;
        writeLocalConfig(config);
        renderSummary();
        return config;
      }
    }

    config = { ...config, ...partial };
    if (Array.isArray(partial.watchPairs)) config.watchPairs = partial.watchPairs;
    if (partial.thresholdPct != null) config.thresholdPct = partial.thresholdPct;
    if (partial.enabled != null) config.enabled = partial.enabled;
    if (Array.isArray(partial.bindings)) {
      config.bindings = partial.bindings.map((b, i) => {
        const url = String(b.url || "").trim();
        return {
          id: b.id || `binding-${i}`,
          name: b.name || b.urlMask || "",
          enabled: b.enabled !== false,
          hasUrl: !!url,
          urlMask: url.length > 4 ? `••••${url.slice(-4)}` : url ? "••••" : "",
          _url: url,
        };
      });
      config.activeBindingCount = config.bindings.filter((b) => b.enabled && b.hasUrl).length;
    }
    writeLocalConfig(config);
    lastStatus = barkApiOk ? lastStatus : "已保存到本机（服务端 API 不可用）";
    renderSummary();
    return config;
  }

  async function toggleWatchPair(pairKey) {
    if (!config) return;
    const set = new Set(config.watchPairs || []);
    if (set.has(pairKey)) {
      set.delete(pairKey);
      if (!set.size) {
        lastStatus = "已无监控方向，已自动暂停提醒";
        await saveConfig({ watchPairs: [], enabled: false });
        return;
      }
    } else {
      set.add(pairKey);
    }
    await saveConfig({ watchPairs: [...set] });
  }

  function openModal(sel, show) {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (!el) return;
    el.hidden = !show;
    el.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function fillThresholdForm() {
    if (!config) return;
    const el = $("#bark-threshold-input");
    if (el) el.value = String(config.thresholdPct ?? 1);
  }

  function renderBindingsForm() {
    const box = $("#bark-bindings-form");
    if (!box) return;
    box.innerHTML = bindingsDraft
      .map(
        (b) => `
      <div class="binding-row" data-id="${escapeHtml(b.id)}">
        <label class="field field-wide">
          <span>Bark 链接</span>
          <input type="text" data-f="url" value="${escapeHtml(b.url)}" placeholder="${escapeHtml(b.urlPlaceholder || "https://api.day.app/你的Key/")}" autocomplete="off" />
        </label>
        <label class="field field-check">
          <input type="checkbox" data-f="enabled" ${b.enabled ? "checked" : ""} />
          启用
        </label>
        <button type="button" class="btn btn-ghost" data-act="test-binding">测试</button>
        <button type="button" class="btn btn-ghost" data-act="del-binding">删除</button>
      </div>`
      )
      .join("");
  }

  function syncBindingsFromForm() {
    const box = $("#bark-bindings-form");
    if (!box) return;
    for (const row of box.querySelectorAll(".binding-row")) {
      const id = row.dataset.id;
      const item = bindingsDraft.find((x) => x.id === id);
      if (!item) continue;
      item.url = row.querySelector('[data-f="url"]')?.value?.trim() || "";
      item.enabled = !!row.querySelector('[data-f="enabled"]')?.checked;
    }
  }

  function openBindingsManager() {
    if (!config) config = defaultConfig();
    bindingsDraft = (config.bindings || []).map((b, i) => ({
      id: b.id || `binding-${i}`,
      url: b._url || "",
      urlPlaceholder: b.urlMask ? `已保存 ${b.urlMask}，留空不修改` : "https://api.day.app/你的Key/",
      enabled: b.enabled !== false,
    }));
    if (!bindingsDraft.length) {
      bindingsDraft = [{ id: `b-${Date.now()}`, url: "", enabled: true }];
    }
    renderBindingsForm();
    openModal("#bark-bindings-modal", true);
  }

  async function saveBindings() {
    syncBindingsFromForm();
    await saveConfig({
      bindings: bindingsDraft.map((b) => ({
        id: b.id,
        url: b.url,
        enabled: b.enabled,
      })),
    });
    openModal("#bark-bindings-modal", false);
  }

  async function saveThreshold() {
    const v = Number($("#bark-threshold-input")?.value);
    await saveConfig({
      thresholdPct: Number.isFinite(v) ? Math.max(0, v) : 1,
    });
    openModal("#bark-threshold-modal", false);
  }

  async function testBinding(bindingId) {
    syncBindingsFromForm();
    const b = bindingsDraft.find((x) => x.id === bindingId);
    if (!b?.url?.trim()) throw new Error("请先填写 Bark 链接");
    if (!(await ensureBarkApi())) {
      throw new Error(
        "无法连接 Bark 后端。请在项目目录执行 ./start.sh 重启（旧进程没有 /api/bark/* 接口）。"
      );
    }
    const r = await fetch("/api/bark/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: b.url,
        title: "测试",
        body: "SPCX Bark 连接正常，可接收价差提醒。",
      }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.errors?.join("; ") || data.error || "推送失败");
    const mask = b.url?.slice(-8) || "Bark";
    lastStatus = `测试已发送（标题：测试 · ${mask}）`;
    renderSummary();
  }

  function pickHitsForPush(hits, cooldownSec) {
    const map = loadCooldownMap();
    const now = Date.now();
    const cd = Math.max(30, cooldownSec) * 1000;
    const out = [];
    for (const h of hits) {
      const k = h.pairKey;
      const last = map[k] || 0;
      if (now - last < cd) continue;
      out.push(h);
      map[k] = now;
    }
    if (out.length) saveCooldownMap(map);
    return out;
  }

  async function onQuote(data) {
    if (!config?.enabled || !data?.spread) return;
    if (!config.watchPairs?.length) {
      lastStatus = "未选择矩阵方向";
      renderSummary();
      return;
    }
    if (!(await ensureBarkApi())) {
      lastStatus = "Bark API 不可用，请 ./start.sh 重启服务";
      renderSummary();
      return;
    }
    try {
      const r = await fetch("/api/bark/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spread: data.spread }),
      });
      if (!r.ok) return;
      const ev = await r.json();
      const hits = ev.hits || [];
      lastStatus = hits.length
        ? `超阈值 ${hits.length} 组（${thresholdLabel(config)}）`
        : "未超阈值";
      renderSummary();
      if (!hits.length) return;

      const toSend = pickHitsForPush(hits, config.cooldownSeconds || 120);
      if (!toSend.length) {
        lastStatus = `超阈值 ${hits.length} 组（冷却中）`;
        renderSummary();
        return;
      }

      const title = spreadPushTitle(toSend);
      const body = spreadPushBody(toSend);

      const pr = await fetch("/api/bark/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const push = await pr.json();
      if (push.ok && push.sent > 0) {
        lastStatus = `已推送 ${push.sent} 个链接 · ${fmtTs(Date.now())}`;
      } else {
        lastStatus = push.errors?.[0] || push.error || "推送失败";
      }
      renderSummary();
    } catch (e) {
      lastStatus = `异常：${e.message}`;
      renderSummary();
    }
  }

  function fmtTs(ms) {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  }

  function bindUi() {
    initPanelCollapse();
    initPairsCollapse();

    $("#bark-enabled-toggle")?.addEventListener("change", async (e) => {
      if (e.target.checked && !(config?.watchPairs?.length)) {
        e.target.checked = false;
        alert("请先在「提醒事件」中选择至少 1 个价差方向");
        return;
      }
      if (e.target.checked && !(config?.activeBindingCount > 0)) {
        e.target.checked = false;
        alert("请先在「Bark 绑定」中添加至少 1 条有效 Bark 链接");
        return;
      }
      try {
        await saveConfig({ enabled: e.target.checked });
      } catch (err) {
        e.target.checked = !e.target.checked;
        alert(`保存失败：${err.message}`);
      }
    });

    $("#bark-pairs-chips")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-pair]");
      if (!btn) return;
      try {
        await toggleWatchPair(btn.dataset.pair);
      } catch (err) {
        alert(`更新失败：${err.message}`);
      }
    });

    $("#btn-bark-select-all")?.addEventListener("click", async () => {
      if (!matrixPairs.length) return;
      await saveConfig({ watchPairs: matrixPairs.map((p) => p.key) });
    });

    $("#btn-bark-clear-pairs")?.addEventListener("click", async () => {
      if (!matrixPairs.length) return;
      lastStatus = "已无监控方向，已自动暂停提醒";
      await saveConfig({ watchPairs: [], enabled: false });
    });

    $("#bark-threshold-pill")?.addEventListener("click", () => {
      fillThresholdForm();
      openModal("#bark-threshold-modal", true);
    });

    $("#btn-bark-threshold-save")?.addEventListener("click", async () => {
      try {
        await saveThreshold();
      } catch (e) {
        alert(`保存失败：${e.message}`);
      }
    });

    $("#btn-bark-threshold-cancel")?.addEventListener("click", () =>
      openModal("#bark-threshold-modal", false)
    );

    $("#btn-manage-bark")?.addEventListener("click", () => {
      try {
        if (!matrixPairs.length) {
          loadMatrixPairs()
            .then(() => openBindingsManager())
            .catch((e) => alert(`加载失败：${e.message}`));
          return;
        }
        openBindingsManager();
      } catch (e) {
        alert(`打开管理失败：${e.message}`);
      }
    });

    $("#btn-add-binding")?.addEventListener("click", () => {
      bindingsDraft.push({ id: `b-${Date.now()}`, url: "", enabled: true });
      renderBindingsForm();
    });

    $("#bark-bindings-form")?.addEventListener("click", async (e) => {
      const act = e.target?.dataset?.act;
      if (act === "del-binding") {
        const row = e.target.closest(".binding-row");
        bindingsDraft = bindingsDraft.filter((x) => x.id !== row?.dataset.id);
        if (!bindingsDraft.length) {
          bindingsDraft = [{ id: `b-${Date.now()}`, url: "", enabled: true }];
        }
        renderBindingsForm();
        return;
      }
      if (act === "test-binding") {
        const row = e.target.closest(".binding-row");
        try {
          syncBindingsFromForm();
          await testBinding(row?.dataset.id);
        } catch (err) {
          alert(err.message);
        }
      }
    });

    $("#btn-bark-bindings-save")?.addEventListener("click", async () => {
      try {
        await saveBindings();
      } catch (e) {
        alert(`保存失败：${e.message}`);
      }
    });

    $("#btn-bark-bindings-cancel")?.addEventListener("click", () =>
      openModal("#bark-bindings-modal", false)
    );

    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", () => {
        const sel = el.getAttribute("data-close-modal");
        if (sel) openModal(sel, false);
      });
    });

    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) openModal(`#${backdrop.id}`, false);
      });
    });
  }

  async function init() {
    bindUi();
    try {
      await loadConfig();
      if (config && !config.watchPairs?.length && matrixPairs.length) {
        await saveConfig({ watchPairs: matrixPairs.map((p) => p.key) });
      }
    } catch (e) {
      lastStatus = `初始化失败：${e.message}`;
      const st = $("#bark-monitor-status");
      if (st) st.textContent = lastStatus;
    }
  }

  window.SpcxBark = { init, onQuote, loadConfig };
  init();
})();
