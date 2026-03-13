    let records = [];
    let editingId = null;
    let editingUpdatedAt = ""; // legacy concurrency token from server
    let editingUpdatedAtTs = 0; // preferred concurrency token (ms timestamp)
    let nextId = 1;

    // ===== Chart 插件：在饼图外显示标签（类型/数量/占比）=====
    // 依赖 chartjs-plugin-datalabels（已在 <head> 引入）
    if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
      try { Chart.register(ChartDataLabels); } catch (e) {}
    }


    // ===== 视图模式：工单 / 回收站 =====
    const VIEW_MODE_STORAGE = "ticket_view_mode";
    let viewMode = "active"; // 'active' | 'trash'

    function loadViewMode() {
      try {
        const v = (localStorage.getItem(VIEW_MODE_STORAGE) || "active").toLowerCase();
        viewMode = (v === "trash") ? "trash" : "active";
      } catch {
        viewMode = "active";
      }
    }
    function saveViewMode() {
      try { localStorage.setItem(VIEW_MODE_STORAGE, viewMode); } catch {}
    }
    function updateViewModeUI() {
      const btn = document.getElementById("trashToggleBtn");
      const pill = document.getElementById("viewModePill");
      if (btn) btn.textContent = viewMode === "trash" ? "返回工单" : "回收站";
      if (pill) {
        pill.textContent = viewMode === "trash" ? "回收站" : "工单";
        pill.classList.remove("on", "off");
        pill.classList.add(viewMode === "trash" ? "off" : "on");
      }
    }
    async function toggleTrashView() {
      viewMode = viewMode === "trash" ? "active" : "trash";
      saveViewMode();
      updateViewModeUI();
      await reloadAndRender({ showLoadedToast: true });
    }


    // ===== 写入口令（仅保护写操作）=====
    const EDIT_KEY_STORAGE = "ticket_edit_key";

    function getEditKey() {
      if (window.TicketAuth && typeof window.TicketAuth.get === "function") return window.TicketAuth.get();
      try { return sessionStorage.getItem(EDIT_KEY_STORAGE) || ""; } catch { return ""; }
    }
    function setEditKey(key) {
      if (window.TicketAuth && typeof window.TicketAuth.set === "function") return window.TicketAuth.set(key);
      try { sessionStorage.setItem(EDIT_KEY_STORAGE, String(key || "")); } catch {}
    }
    function clearEditKey() {
      if (window.TicketAuth && typeof window.TicketAuth.clear === "function") return window.TicketAuth.clear();
      try { sessionStorage.removeItem(EDIT_KEY_STORAGE); } catch {}
    }
    

    const EDIT_KEY_SET_AT_STORAGE = "ticket_edit_key_set_at";

    function getEditKeySetAt() {
      if (window.TicketAuth && typeof window.TicketAuth.getSetAt === "function") return window.TicketAuth.getSetAt();
      try { return sessionStorage.getItem(EDIT_KEY_SET_AT_STORAGE) || ""; } catch { return ""; }
    }
    function setEditKeySetAtNow() {
      if (window.TicketAuth && typeof window.TicketAuth.setSetAtNow === "function") return window.TicketAuth.setSetAtNow();
      try { sessionStorage.setItem(EDIT_KEY_SET_AT_STORAGE, new Date().toISOString()); } catch {}
    }
    function clearEditKeySetAt() {
      if (window.TicketAuth && typeof window.TicketAuth.clearSetAt === "function") return window.TicketAuth.clearSetAt();
      try { sessionStorage.removeItem(EDIT_KEY_SET_AT_STORAGE); } catch {}
    }

    function formatISOToLocal(iso) {
      if (!iso) return "-";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    let __editKeyWaiters = [];
    function resolveEditKeyWaiters(value) {
      try {
        __editKeyWaiters.forEach((r) => r(value));
      } finally {
        __editKeyWaiters = [];
      }
    }

    function updateEditKeyStatus() {
      const key = getEditKey();
      const on = !!key;
      const setAt = formatISOToLocal(getEditKeySetAt());

      const applyPill = (el) => {
        if (!el) return;
        el.classList.remove("on", "off");
        el.classList.add(on ? "on" : "off");
        el.textContent = on ? "已设置" : "未设置";
      };

      applyPill(document.getElementById("editKeyStatus"));
      applyPill(document.getElementById("editKeyStatus2"));

      const el1 = document.getElementById("editKeySetAt");
      const el2 = document.getElementById("editKeySetAt2");
      if (el1) el1.textContent = on ? setAt : "-";
      if (el2) el2.textContent = on ? setAt : "-";

      const btn = document.getElementById("btnOneClick");
      if (btn) btn.disabled = !on;
    }

    function openKeyModal() {
      const modal = document.getElementById("keyModal");
      if (!modal) return;
      modal.classList.add("show");
      const input = document.getElementById("editKeyInput");
      if (input) input.value = getEditKey() || "";
      const show = document.getElementById("editKeyShow");
      if (show) show.checked = false;
      if (input) input.type = "password";
      updateEditKeyStatus();
      if (input) input.focus();
    }

    function closeKeyModal() {
      const modal = document.getElementById("keyModal");
      if (!modal) return;
      modal.classList.remove("show");
      // 如果有等待 ensureEditKey 的调用，关闭视为放弃
      resolveEditKeyWaiters(getEditKey() || "");
    }

    function onKeyModalMaskClick(e) {
      if (e.target && e.target.id === "keyModal") closeKeyModal();
    }

    function toggleEditKeyVisibility() {
      const input = document.getElementById("editKeyInput");
      const show = document.getElementById("editKeyShow");
      if (!input || !show) return;
      input.type = show.checked ? "text" : "password";
    }

    function saveEditKeyFromUI() {
      const input = document.getElementById("editKeyInput");
      const key = (input ? input.value : "").trim();
      if (!key) {
        clearEditKey();
        clearEditKeySetAt();
        updateEditKeyStatus();
        resolveEditKeyWaiters("");
        if (typeof showToast === "function") showToast("已清除写入口令。", "success");
        return;
      }
      setEditKey(key);
      setEditKeySetAtNow();
      updateEditKeyStatus();
      resolveEditKeyWaiters(key);
      if (typeof showToast === "function") showToast("写入口令已保存（仅当前浏览器）。", "success");
    }

    function clearEditKeyFromUI() {
      clearEditKey();
      clearEditKeySetAt();
      const input = document.getElementById("editKeyInput");
      if (input) input.value = "";
      updateEditKeyStatus();
      resolveEditKeyWaiters("");
      if (typeof showToast === "function") showToast("已清除写入口令。", "success");
    }

    async function ensureEditKey() {
      const existing = getEditKey();
      if (existing) return existing;

      // 弹出设置窗口，并等待用户保存/关闭
      openKeyModal();
      if (typeof showToast === "function") showToast("请先设置写入口令后再执行写操作。", "warning");

      return await new Promise((resolve) => {
        __editKeyWaiters.push(resolve);
      });
    }

    async function testEditKey() {
      const key = getEditKey();
      if (!key) {
        openKeyModal();
        if (typeof showToast === "function") showToast("请先设置写入口令，再进行测试。", "warning");
        return;
      }
      try {
        const res = await fetch("/api/auth-test", {
          method: "GET",
          headers: { "X-EDIT-KEY": key },
          cache: "no-store",
        });
        if (res.ok) {
          if (typeof showToast === "function") showToast("口令测试通过 ✅", "success");
        } else if (res.status === 401) {
          clearEditKey();
          clearEditKeySetAt();
          updateEditKeyStatus();
          if (typeof showToast === "function") showToast("口令错误（401），请重新设置。", "error");
          openKeyModal();
        } else if (res.status === 500) {
          if (typeof showToast === "function") showToast("服务端未配置 EDIT_KEY（500）。", "error");
        } else {
          if (typeof showToast === "function") showToast(`测试失败：${res.status}`, "error");
        }
      } catch (e) {
        if (typeof showToast === "function") showToast("无法连接服务端进行测试。", "error");
      }
    }


// ===== 一键初始化 / 自检 =====
let __oneClickLast = null;

function setOneClickPill(state, text) {
  const el = document.getElementById("oneClickStatus");
  if (!el) return;
  el.classList.remove("on", "off");
  el.classList.add(state === "on" ? "on" : "off");
  el.textContent = text || (state === "on" ? "成功" : "未运行");
}

function setOneClickAtNow() {
  const el = document.getElementById("oneClickAt");
  if (!el) return;
  el.textContent = new Date().toLocaleString();
}


function showModalPre({ title = "提示", text = "", okText = "关闭", copyText = "复制", variant = "primary" } = {}) {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  const prevFocus = document.activeElement;
  if (!overlay || !titleEl || !bodyEl || !footerEl) {
    alert(text);
    return Promise.resolve();
  }

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
  titleEl.textContent = title;
  bodyEl.innerHTML = "";

  const pre = document.createElement("pre");
  pre.style.maxHeight = "55vh";
  pre.style.overflow = "auto";
  pre.style.margin = "0";
  pre.style.padding = "12px";
  pre.style.border = "1px solid #eee";
  pre.style.borderRadius = "12px";
  pre.style.background = "#fafafa";
  pre.style.fontSize = "12px";
  pre.style.lineHeight = "1.5";
  pre.textContent = text;
  bodyEl.appendChild(pre);

  footerEl.innerHTML = "";

  const copyBtn = document.createElement("button");
  copyBtn.className = "m-btn secondary";
  copyBtn.textContent = copyText;
  copyBtn.onclick = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      if (typeof showToast === "function") showToast("已复制到剪贴板", "success");
    } catch (e) {
      if (typeof showToast === "function") showToast("复制失败，请手动选择复制", "error");
    }
  };

  const okBtn = document.createElement("button");
  okBtn.className = `m-btn ${variant}`;
  okBtn.textContent = okText;

  const close = () => {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
    if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
  };

  okBtn.onclick = close;

  footerEl.appendChild(copyBtn);
  footerEl.appendChild(okBtn);

  return Promise.resolve();
}

function formatMs(ms){
  if (ms == null || ms === "" || isNaN(ms)) return "-";
  const n = Number(ms);
  if (n < 1000) return `${Math.round(n)} ms`;
  const s = n/1000;
  if (s < 60) return `${s.toFixed(2)} s`;
  const m = Math.floor(s/60);
  const ss = Math.round(s%60);
  return `${m}m ${ss}s`;
}

function pill(text, tone="neutral"){
  const span=document.createElement("span");
  span.className=`pill ${tone}`;
  span.textContent = (text===null || text===undefined || text==='') ? '未执行' : String(text);
  return span;
}

function makeKV(label, valueNode){
  const row=document.createElement("div");
  row.className="kv";
  const k=document.createElement("div");
  k.className="k";
  k.textContent=label;
  const v=document.createElement("div");
  v.className="v";
  if (valueNode instanceof Node) v.appendChild(valueNode);
  else v.textContent=String(valueNode ?? "-");
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function showModalDetails({ title="详情", summaryTitle="摘要", summaryItems=[], jsonText="", okText="关闭", copyText="复制 JSON", variant="primary" } = {}){
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  const prevFocus = document.activeElement;
  if (!overlay || !titleEl || !bodyEl || !footerEl) {
    alert(jsonText || "");
    return Promise.resolve();
  }

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
  titleEl.textContent = title;
  bodyEl.innerHTML = "";

  // Summary card
  const card=document.createElement("div");
  card.className="details-card";
  const h=document.createElement("div");
  h.className="details-title";
  h.textContent=summaryTitle;
  card.appendChild(h);

  const grid=document.createElement("div");
  grid.className="details-grid";
  (summaryItems||[]).forEach(it=>{
    if(!it) return;
    const {label, value, tone} = it;
    const valNode = (value instanceof Node) ? value : pill(String(value ?? "-"), tone || "neutral");
    grid.appendChild(makeKV(label, valNode));
  });
  card.appendChild(grid);
  bodyEl.appendChild(card);

  // Raw JSON (collapsible)
  const details=document.createElement("details");
  details.className="details-raw";
  details.open=false;

  const sum=document.createElement("summary");
  sum.textContent="原始 JSON";
  details.appendChild(sum);

  const pre = document.createElement("pre");
  pre.style.maxHeight = "45vh";
  pre.style.overflow = "auto";
  pre.style.margin = "10px 0 0 0";
  pre.style.padding = "12px";
  pre.style.border = "1px solid #eee";
  pre.style.borderRadius = "12px";
  pre.style.background = "#fafafa";
  pre.style.fontSize = "12px";
  pre.style.lineHeight = "1.5";
  pre.textContent = jsonText || "";
  details.appendChild(pre);

  bodyEl.appendChild(details);

  footerEl.innerHTML = "";

  const copyBtn = document.createElement("button");
  copyBtn.className = "m-btn secondary";
  copyBtn.textContent = copyText;
  copyBtn.onclick = async () => {
    try {
      const toCopy = jsonText || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(toCopy);
      } else {
        const ta = document.createElement("textarea");
        ta.value = toCopy;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      if (typeof showToast === "function") showToast("已复制到剪贴板", "success");
    } catch (e) {
      if (typeof showToast === "function") showToast("复制失败，请手动选择复制", "error");
    }
  };

  const okBtn = document.createElement("button");
  okBtn.className = `m-btn ${variant}`;
  okBtn.textContent = okText;

  const close = () => {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
    if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
  };
  okBtn.onclick = close;

  footerEl.appendChild(copyBtn);
  footerEl.appendChild(okBtn);

  return Promise.resolve();
}

function normalizeOneClickResult(raw) {
  // raw may be {ok,...} or {ok, data:{...}} depending on endpoint implementation
  const r = (raw && typeof raw === "object" && raw.data && typeof raw.data === "object") ? raw.data : (raw || {});
  const out = { raw: raw || {}, data: r || {} };

  // helpers
  const pick = (obj, keys, defVal = undefined) => {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return defVal;
  };

  // Support both:
  // 1) direct fields: { migrate:{...}, fts_rebuild:{...}, selfcheck:{...} }
  // 2) steps list: { steps:[ { name:'migrate', ok:true, ... }, ... ] }
  const stepsVal = pick(r, ['steps','step','detail','details','runs'], null);
  const stepsArr = Array.isArray(stepsVal) ? stepsVal : null;
  const stepsObj = (!stepsArr && stepsVal && typeof stepsVal === 'object') ? stepsVal : null;
  const byName = (name) => {
    if (stepsArr) {
      return stepsArr.find(s => (s && (s.name === name || s.step === name || s.type === name))) || null;
    }
    if (stepsObj) {
      // support direct object map: steps.{migrate, fts_rebuild, selfcheck}
      return stepsObj[name] || stepsObj[name.replace(/-/g,'_')] || stepsObj[name.replace(/_/g,'-')] || null;
    }
    return null;
  };

  out.migrate = r.migrate || byName('migrate') || null;
  out.fts = r.fts_rebuild || r.fts || byName('fts_rebuild') || byName('rebuild') || byName('fts') || null;
  out.selfcheck = r.selfcheck || byName('selfcheck') || byName('check') || null;

  // duration: prefer explicit, else sum steps duration fields if available
  const dur =
    pick(r, ['duration_ms','duration','took_ms','took'], null) ??
    (pick(out.migrate, ['duration_ms','duration','took_ms','took'], 0) +
     pick(out.fts, ['duration_ms','duration','took_ms','took'], 0) +
     pick(out.selfcheck, ['duration_ms','duration','took_ms','took'], 0));

  out.duration = (typeof dur === 'number' && isFinite(dur) && dur > 0) ? dur : null;

  // overall ok: prefer top-level ok else infer from steps present
    out.ok = (typeof r.ok === 'boolean') ? r.ok : (typeof raw?.ok === 'boolean' ? raw.ok : null);

  return out;
}

function stepLabel(obj) {
  if (!obj) return { text: '未执行', tone: 'neutral' };
  if (obj.skipped || obj.skip) return { text: '跳过', tone: 'neutral' };
  if (obj.ok === true) return { text: '成功', tone: 'good' };
  if (obj.ok === false) return { text: '失败', tone: 'bad' };
  const st = (obj.status || obj.state || '').toString().toLowerCase();
  if (st === 'ok' || st === 'success') return { text: '成功', tone: 'good' };
  if (st === 'fail' || st === 'error') return { text: '失败', tone: 'bad' };
  if (st === 'skip' || st === 'skipped') return { text: '跳过', tone: 'neutral' };
  return { text: '未知', tone: 'neutral' };
}


function stepLabel(obj) {
  if (!obj) return { text: "未执行", tone: "neutral" };
  if (obj.skipped || obj.skip) return { text: "跳过", tone: "neutral" };
  if (obj.ok === true) return { text: "成功", tone: "good" };
  if (obj.ok === false) return { text: "失败", tone: "bad" };
  // Some implementations return {status:'ok'|'fail'|'skip'}
  const st = (obj.status || obj.state || "").toString().toLowerCase();
  if (st === "ok" || st === "success") return { text: "成功", tone: "good" };
  if (st === "fail" || st === "error") return { text: "失败", tone: "bad" };
  if (st === "skip" || st === "skipped") return { text: "跳过", tone: "neutral" };
  return { text: "未知", tone: "neutral" };
}

function showOneClickDetails() {
  if (!__oneClickLast) {
    if (typeof showToast === "function") showToast("暂无运行详情。", "info");
    return;
  }

  const n = normalizeOneClickResult(__oneClickLast);
  const pretty = JSON.stringify(n.raw, null, 2);

  const mig = n.migrate;
  const fts = n.fts;
  const sc = n.selfcheck;

  let overallOk = n.ok;
  if (overallOk === null) {
    const flags = [mig, fts, sc].filter(Boolean).map(x => x.ok);
    if (flags.length) overallOk = flags.every(x => x === true);
  }

  const overall = overallOk === true
    ? { text: "成功", tone: "good" }
    : overallOk === false
      ? { text: "失败", tone: "bad" }
      : { text: "未知", tone: "neutral" };

  const migL = stepLabel(mig);
  const ftsL = stepLabel(fts);
  const scL  = stepLabel(sc);

  const items = [
    { label: "总状态", value: overall.text, tone: overall.tone },
    { label: "迁移(migrate)", value: migL.text, tone: migL.tone },
    { label: "FTS 重建(rebuild)", value: ftsL.text, tone: ftsL.tone },
    { label: "自检(selfcheck)", value: scL.text, tone: scL.tone },
  ];

  // schema version hints (best-effort)
  if (mig) {
    const before = (mig.before ?? mig.current ?? mig.from ?? null);
    const after  = (mig.after  ?? mig.latest  ?? mig.to   ?? null);
    if (before !== null || after !== null) {
      items.push({
        label: "schema 版本",
        value: `${before ?? "-"} → ${after ?? "-"}`,
        tone: (before !== null && after !== null && before !== after) ? "good" : "neutral"
      });
    }
    const pend = (mig.pending || mig.pending_before || mig.todo || null);
    if (Array.isArray(pend) && pend.length) {
      items.push({ label: "待迁移", value: `${pend.length} 项`, tone: "warn" });
    }
  }

  // FTS / index signals from selfcheck
  const scFts = (sc && (sc.fts || sc.fts_status)) ? (sc.fts || sc.fts_status) : null;
  if (scFts) {
    const cnt = (scFts.count ?? scFts.cnt ?? scFts.rows ?? null);
    if (cnt !== null && cnt !== undefined) items.push({ label: "FTS 行数", value: String(cnt), tone: "neutral" });
    const exists = scFts.exists;
    if (exists === false) items.push({ label: "FTS 表", value: "不存在", tone: "bad" });
  }
  const idx = sc ? (sc.indexes || sc.index) : null;
  if (idx) {
    const miss = idx.missing || idx.missings || [];
    if (Array.isArray(miss)) items.push({ label: "索引缺失", value: miss.length ? `${miss.length} 个` : "无", tone: miss.length ? "warn" : "good" });
  }

  items.push({ label: "耗时", value: n.duration ? formatMs(n.duration) : "未知", tone: "neutral" });

  showModalDetails({
    title: "一键初始化 / 自检 详情",
    summaryTitle: "运行摘要",
    summaryItems: items,
    jsonText: pretty,
    okText: "关闭",
    copyText: "复制 JSON",
    variant: "primary",
  });
}
function openOneClickDetails() {
  if (!__oneClickLast) {
    if (typeof showToast === "function") showToast("暂无运行详情。", "info");
    return;
  }
  const pretty = JSON.stringify(__oneClickLast, null, 2);
  showModalPre({
    title: "一键初始化 / 自检 详情",
    text: pretty,
    okText: "关闭",
    copyText: "复制 JSON",
    variant: "primary",
  });
}

async function runOneClickInit() {
  const key = getEditKey();
  if (!key) {
    openKeyModal();
    if (typeof showToast === "function") showToast("请先设置写入口令，再执行一键初始化。", "warning");
    return;
  }
  const btn = document.getElementById("btnOneClick");
  if (btn) btn.disabled = true;

  try {
    if (typeof showToast === "function") showToast("正在执行：迁移 → FTS 重建 → 自检…", "info");
    const res = await fetch("/api/admin/oneclick", {
      method: "POST",
      headers: { "X-EDIT-KEY": key },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    __oneClickLast = data;

    if (res.ok && data && data.ok) {
      setOneClickPill("on", "成功");
      setOneClickAtNow();
      if (typeof showToast === "function") showToast("一键初始化/自检完成 ✅", "success");
    } else if (res.status === 403) {
      clearEditKey();
      clearEditKeySetAt();
      updateEditKeyStatus();
      setOneClickPill("off", "无权限");
      if (typeof showToast === "function") showToast("口令无效（403），请重新设置。", "error");
      openKeyModal();
    } else {
      setOneClickPill("off", "失败");
      setOneClickAtNow();
      if (typeof showToast === "function") showToast("一键初始化/自检失败，可点“查看详情”。", "error");
    }
  } catch (e) {
    __oneClickLast = { ok: false, error: String(e) };
    setOneClickPill("off", "失败");
    setOneClickAtNow();
    if (typeof showToast === "function") showToast("一键初始化/自检异常，可点“查看详情”。", "error");
  } finally {
    if (btn) btn.disabled = !getEditKey();
  }
}

// ⭐ 本地存储：从 localStorage 恢复 records
    function loadFromLocal() {
      try {
        const saved = localStorage.getItem("ticket_records");
        if (saved) {
          const data = JSON.parse(saved);
          if (Array.isArray(data)) {
            records = normalizeRecords(data);
            const maxId = records.reduce((max, r) => {
              const v = Number(r.id);
              return Number.isFinite(v) ? Math.max(max, v) : max;
            }, 0);
            nextId = maxId + 1;
          }
        }
      } catch (e) {
        console.error("从本地恢复数据失败：", e);
      }
    }

    // ===== 云端存储（Cloudflare Pages Functions + D1）=====
    async function loadFromServer() {
      const res = await fetch("/api/tickets", { cache: "no-store" });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      const data = await res.json();
      records = normalizeRecords(Array.isArray(data) ? data : []);
      const maxId = records.reduce((max, r) => {
        const v = Number(r.id);
        return Number.isFinite(v) ? Math.max(max, v) : max;
      }, 0);
      nextId = maxId + 1;
    }

    async function reloadAndRender({ showLoadedToast = false } = {}) {
      await loadFromServer();
      saveToLocal(); // 缓存一份到本地，作为兜底
      refreshYearOptions();
      renderTable();
      if (showLoadedToast) {
        showToast(`已从云端加载 ${records.length} 条${viewMode === "trash" ? "回收站记录" : "工单"}`, "success");
      }
    }


    async function authedFetch(url, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      const needAuth = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
      if (!needAuth) return fetch(url, options);

      const key = await ensureEditKey();
      const headers = new Headers(options.headers || {});
      if (key) headers.set("X-EDIT-KEY", key);

	      const res = await fetch(url, { ...options, headers });

	      if (res.status === 401 || res.status === 403) {
	        clearEditKey();
	        updateEditKeyStatus();
	        if (typeof showToast === "function") showToast("写入口令错误，请重新输入。", "error");
	      } else if (res.status === 500) {
	        // 500 可能是后端真实异常，也可能是 EDIT_KEY 未配置。
	        // 仅当响应内容明确提示 EDIT_KEY 缺失时才弹该提示。
	        try {
	          const t = await res.clone().text();
	          if (/EDIT_KEY|misconfigured/i.test(t)) {
	            if (typeof showToast === "function") showToast("服务端未配置 EDIT_KEY。", "error");
	          }
	        } catch {
	          // ignore
	        }
	      }
	      return res;
    }
	
	    // 用于 catch 中判断：401（口令错误）已经在 authedFetch 里提示过了，就不再显示通用错误 toast。
	    function isNoKeyError(err) {
	      const msg = String((err && err.message) || err || "");
	      return /\b401\b/.test(msg) || /Unauthorized/i.test(msg);
	    }
    

    

    // ===== 新增/编辑弹窗（Modal）=====
    function openTicketModal(reset = true) {
      const mask = document.getElementById("ticketModal");
      if (!mask) return;
      mask.classList.add("show");
      if (reset) {
        resetForm(true);
      }
      // 聚焦日期输入，便于连续录入
      setTimeout(() => {
        const el = document.getElementById("date");
        if (el) el.focus();
      }, 0);
    }

    function closeTicketModal() {
      const mask = document.getElementById("ticketModal");
      if (!mask) return;
      mask.classList.remove("show");
    }

    function onTicketModalMaskClick(e) {
      if (e && e.target && e.target.id === "ticketModal") closeTicketModal();
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeTicketModal();
    });

// 统一数据结构：内部一律使用 {id,date,issue,department,name,solution,remarks,type}
    function normalizeRecord(r, fallbackId) {
      const obj = (r && typeof r === "object") ? r : {};
      return {
        id: (() => { const v = Number(obj.id ?? obj.ID ?? obj.Id ?? fallbackId); return Number.isFinite(v) ? v : fallbackId; })(),
        date: obj.date ?? obj.日期 ?? obj.time ?? obj.createdAt ?? "",
        issue: obj.issue ?? obj.问题 ?? obj.question ?? obj.title ?? obj.subject ?? "",
        department: obj.department ?? obj.dept ?? obj.部门 ?? obj.departmentName ?? "",
        name: obj.name ?? obj.owner ?? obj.person ?? obj.姓名 ?? obj.handler ?? "",
        solution: obj.solution ?? obj.method ?? obj.处理方法 ?? obj.fix ?? "",
        remarks: obj.remarks ?? obj.remark ?? obj.备注 ?? obj.note ?? "",
        type: obj.type ?? obj.类型 ?? obj.category ?? "",
        updated_at: obj.updated_at ?? obj.updatedAt ?? "",
        updated_at_ts: obj.updated_at_ts ?? obj.updatedAtTs ?? obj.updatedAtTS ?? 0,
        is_deleted: Number(obj.is_deleted ?? obj.isDeleted ?? 0) ? 1 : 0,
        deleted_at: obj.deleted_at ?? obj.deletedAt ?? ""
      };
    }

    function normalizeRecords(arr) {
      if (!Array.isArray(arr)) return [];
      return arr.map((r, idx) => normalizeRecord(r, idx + 1));
    }
let activeYear = ""; // 当前选择的年份（字符串，如 "2025"）
    let activeMonth = ""; // 当前选择的月份（字符串，"01" ~ "12"）

    let typePieChart = null;
    let monthBarChart = null;


// ===== 分页配置（每页最多 100 条）=====
const PAGE_SIZE_MAX = 100;
let pageSize = 100;     // 可选更小，但上限 100
let currentPage = 1;

// ===== Keyset 游标分页（用于“上一页/下一页”更快；页码跳转仍走 OFFSET） =====
let cursorNav = null; // { cursor: string, direction: 'next'|'prev' }
let cursorKey = "";   // 当前筛选 + viewMode + pageSize
const pageCursorMap = new Map(); // page -> { next_cursor, prev_cursor }

// ===== 服务端分页（大数据量） =====
let serverTotal = 0;          // 当前筛选下的总条数（用于分页 UI）
let metaMonthCounts = {};     // 用于年份/月份按钮的“全量月份分布”（不受筛选影响，仅区分工单/回收站）
let metaTotalAll = 0;         // 当前模式（工单/回收站）的总条数（不受筛选影响）
let lastStatsKey = "";
let cachedStats = null;

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

// ===== 统一提示/弹窗（更好看的 UI，替代 alert / confirm）=====
function showToast(message, variant = "info", title = "") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    // 兜底：容器不存在时仍然不阻断主流程
    console.log(`[${variant}] ${title ? title + " - " : ""}${message}`);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  toast.innerHTML = `${title ? `<div class="title">${escapeHtml(title)}</div>` : ""}<div>${escapeHtml(message)}</div>`;
  container.appendChild(toast);

  // 强制触发一次 layout，保证动画生效
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function showModal({ title = "提示", message = "", okText = "确定", variant = "primary" } = {}) {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  const prevFocus = document.activeElement;
  if (!overlay || !titleEl || !bodyEl || !footerEl) {
    // 兜底
    alert(message);
    return Promise.resolve();
  }

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
  titleEl.textContent = title;
  // 支持 \n 换行，并保证安全（避免 XSS）
  bodyEl.innerHTML = escapeHtml(message).replace(/\n/g, "<br>");
  footerEl.innerHTML = "";

  const okBtn = document.createElement("button");
  okBtn.className = `m-btn ${variant === "danger" ? "danger" : "primary"}`;
  okBtn.textContent = okText;

  return new Promise(resolve => {
    function close() {
      overlay.classList.remove("show");

      // 先把焦点移出 overlay，避免 aria-hidden 警告
      try {
        if (prevFocus && typeof prevFocus.focus === "function") {
          prevFocus.focus({ preventScroll: true });
        } else if (document.body && typeof document.body.focus === "function") {
          document.body.focus({ preventScroll: true });
        }
      } catch (_) {}

      overlay.setAttribute("aria-hidden", "true");
      overlay.onclick = null;
      window.removeEventListener("keydown", onKeyDown);
      resolve();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") close();
    }

    okBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    window.addEventListener("keydown", onKeyDown);

    footerEl.appendChild(okBtn);
    okBtn.focus({ preventScroll: true });
  });
}

function showConfirm({ title = "确认操作", message = "", confirmText = "确定", cancelText = "取消", danger = false } = {}) {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  const footerEl = document.getElementById("modalFooter");
  const prevFocus = document.activeElement;
  if (!overlay || !titleEl || !bodyEl || !footerEl) {
    return Promise.resolve(confirm(message));
  }

  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
  titleEl.textContent = title;
  // 支持 \n 换行，并保证安全（避免 XSS）
  bodyEl.innerHTML = escapeHtml(message).replace(/\n/g, "<br>");
  footerEl.innerHTML = "";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "m-btn secondary";
  cancelBtn.textContent = cancelText;

  const okBtn = document.createElement("button");
  okBtn.className = `m-btn ${danger ? "danger" : "primary"}`;
  okBtn.textContent = confirmText;

  return new Promise(resolve => {
    function close(result) {
      overlay.classList.remove("show");

      // 先把焦点移出 overlay，避免 aria-hidden 警告
      try {
        if (prevFocus && typeof prevFocus.focus === "function") {
          prevFocus.focus({ preventScroll: true });
        } else if (document.body && typeof document.body.focus === "function") {
          document.body.focus({ preventScroll: true });
        }
      } catch (_) {}

      overlay.setAttribute("aria-hidden", "true");
      overlay.onclick = null;
      window.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }

    function onKeyDown(e) {
      if (e.key === "Escape") close(false);
    }

    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    window.addEventListener("keydown", onKeyDown);

    footerEl.appendChild(cancelBtn);
    footerEl.appendChild(okBtn);
    okBtn.focus({ preventScroll: true });
  });
}

    // ⭐ 本地存储：保存 records 到 localStorage
    function saveToLocal() {
      try {
        localStorage.setItem("ticket_records", JSON.stringify(records));
      } catch (e) {
        console.error("保存到本地失败：", e);
      }
    }


    function saveViewState() {
      try {
        localStorage.setItem("ticket_view_year", activeYear || "");
        localStorage.setItem("ticket_view_month", activeMonth || "");
      } catch (e) {
        // ignore
      }
    }

    function loadViewState() {
      try {
        activeYear = localStorage.getItem("ticket_view_year") || "";
        activeMonth = localStorage.getItem("ticket_view_month") || "";
      } catch (e) {
        activeYear = "";
        activeMonth = "";
      }
    }


    // ⭐ 本地存储：从 localStorage 恢复 records
    function loadFromLocal() {
      try {
        const saved = localStorage.getItem("ticket_records");
        if (saved) {
          const data = JSON.parse(saved);
          if (Array.isArray(data)) {
            records = normalizeRecords(data);
            const maxId = records.reduce((max, r) => {
              const v = Number(r.id);
              return Number.isFinite(v) ? Math.max(max, v) : max;
            }, 0);
            nextId = maxId + 1;
          }
        }
      } catch (e) {
        console.error("从本地恢复数据失败：", e);
      }
    }

    // ===== 云端存储（Cloudflare Pages Functions + D1，服务端分页/筛选）=====
    function monthLastDay(year, month) {
      // month: 1-12
      const y = Number(year);
      const m = Number(month);
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
      // JS: day 0 of next month = last day of current month
      return new Date(y, m, 0).getDate();
    }

    function maxDate(a, b) {
      if (!a) return b || "";
      if (!b) return a || "";
      return a >= b ? a : b; // YYYY-MM-DD lexicographic works
    }

    function minDate(a, b) {
      if (!a) return b || "";
      if (!b) return a || "";
      return a <= b ? a : b;
    }

    function buildFilters({ includeYearMonth = true } = {}) {
      const sp = new URLSearchParams();
      if (viewMode === "trash") sp.set("trash", "1");

      // 年/月视图 -> 转成日期范围
      let rangeFrom = "";
      let rangeTo = "";
      if (includeYearMonth && activeYear) {
        if (activeMonth) {
          const last = String(monthLastDay(activeYear, Number(activeMonth))).padStart(2, "0");
          rangeFrom = `${activeYear}-${activeMonth}-01`;
          rangeTo = `${activeYear}-${activeMonth}-${last}`;
        } else {
          rangeFrom = `${activeYear}-01-01`;
          rangeTo = `${activeYear}-12-31`;
        }
      }

      const fromInput = (document.getElementById("filterFrom")?.value || "").trim();
      const toInput = (document.getElementById("filterTo")?.value || "").trim();
      const type = (document.getElementById("filterType")?.value || "").trim();
      const q = (document.getElementById("filterKeyword")?.value || "").trim();

      const from = maxDate(rangeFrom, fromInput);
      const to = minDate(rangeTo, toInput);

      if (from) sp.set("from", from);
      if (to) sp.set("to", to);
      if (type) sp.set("type", type);
      if (q) sp.set("q", q);
      return sp;
    }

    function buildCursorKey() {
      // 游标分页需要在“筛选条件不变”时才可复用 cursor
      const sp = buildFilters({ includeYearMonth: true });
      sp.set("pageSize", String(pageSize));
      return sp.toString();
    }

    function buildStatsKey() {
      // stats 不包含分页参数
      return buildFilters({ includeYearMonth: true }).toString();
    }

    async function loadMetaFromServer() {
      // 仅用于：年/月可用性与总量展示（不受筛选影响）
      const sp = new URLSearchParams();
      if (viewMode === "trash") sp.set("trash", "1");
      const res = await fetch(`/api/stats?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`meta stats failed: ${res.status}`);
      const j = await res.json();
      metaMonthCounts = (j && j.month_counts) ? j.month_counts : {};
      metaTotalAll = Number(j?.total_all ?? 0) || 0;
    }

    async function loadPageFromServer() {
      const sp = buildFilters({ includeYearMonth: true });
      sp.set("page", String(currentPage));
      sp.set("pageSize", String(pageSize));

      // 游标分页：仅用于“上一页/下一页”顺序翻页。
      if (cursorNav && cursorNav.cursor) {
        sp.set("cursor", cursorNav.cursor);
        sp.set("direction", cursorNav.direction || "next");
      }

      const res = await authedFetch(`/api/tickets?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      const j = await res.json();

      const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);
      records = normalizeRecords(arr);
      serverTotal = Number(j?.total ?? records.length) || 0;

      // 兼容后端回传 page/pageSize
      const p = Number(j?.page);
      const ps = Number(j?.pageSize);
      if (Number.isFinite(ps) && ps > 0) pageSize = Math.min(ps, PAGE_SIZE_MAX);
      if (Number.isFinite(p) && p > 0) currentPage = p;

      // 记录本页游标，用于更快的 prev/next
      if (j && (j.next_cursor || j.prev_cursor)) {
        pageCursorMap.set(currentPage, {
          next_cursor: j.next_cursor || null,
          prev_cursor: j.prev_cursor || null,
        });
      }

      // 本次游标导航只生效一次
      cursorNav = null;
    }

    async function loadStatsFromServer() {
      const key = buildStatsKey();
      if (key && key === lastStatsKey && cachedStats) return cachedStats;
      lastStatsKey = key;

      const sp = buildFilters({ includeYearMonth: true });
      const res = await fetch(`/api/stats?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`stats failed: ${res.status}`);
      cachedStats = await res.json();
      return cachedStats;
    }

    async function reloadAndRender({ showLoadedToast = false } = {}) {
      // 1) meta（用于年份/月按钮）
      try {
        await loadMetaFromServer();
      } catch (e) {
        console.warn("loadMetaFromServer failed:", e);
        // meta 失败不阻断主流程
        metaMonthCounts = {};
        metaTotalAll = 0;
      }

      refreshYearOptions();
      await renderTable({ resetPage: true });

      if (showLoadedToast) {
        showToast(`已从云端加载（当前筛选）共 ${serverTotal} 条`, "success");
      }
    }

async function addOrUpdateRecord() {
  const date = document.getElementById("date").value;
  const issue = document.getElementById("issue").value.trim();
  const department = document.getElementById("department").value.trim();
  const name = document.getElementById("name").value.trim();
  const solution = document.getElementById("solution").value.trim();
  const remarks = document.getElementById("remarks").value.trim();
  const type = document.getElementById("type").value;

  const payload = { date, issue, department, name, solution, remarks, type };
  const checked = window.TicketValidation ? window.TicketValidation.validateTicketForm(payload) : { ok: !!date && !!issue, errors: [] };
  if (!checked.ok) {
    showToast((window.TicketValidation ? window.TicketValidation.render(checked.errors) : "请至少填写日期和问题！"), "warning");
    return;
  }

  const btn = document.getElementById("submitBtn");
  const oldText = btn ? btn.innerText : "";
  if (btn) {
    btn.disabled = true;
    btn.innerText = editingId === null ? "保存中..." : "保存中...";
  }

  try {
    if (editingId === null) {
      const res = await authedFetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
    } else {
      // 带上 updated_at 做乐观并发控制
      let res = await authedFetch(`/api/tickets/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, id: editingId, updated_at: editingUpdatedAt, updated_at_ts: editingUpdatedAtTs })
      });

      // 冲突：别人已更新 -> 409
      if (res.status === 409) {
        let info = null;
        try { info = await res.json(); } catch {}
        const latest = info && info.current ? normalizeRecord(info.current, editingId) : null;

        const overwrite = await showConfirm({
          title: "编辑冲突",
          message: `建议使用【合并导入】（不清空云端）。

合并规则：仅当备份记录的 updated_at 更新更晚时才覆盖云端同 id 记录。

- 确认：合并到云端（安全）
- 取消：仅导入本地（只影响你当前浏览器）`,
        confirmText: "覆盖保存",
          cancelText: "加载最新",
          danger: true
        });

        if (!overwrite) {
          await reloadAndRender({ showLoadedToast: false });
          if (latest) {
            fillFormFromRecord(latest);
          }
          showToast("已加载最新版本，请确认后重新编辑保存。", "info");
          return;
        }

        // 覆盖保存（force）
        res = await authedFetch(`/api/tickets/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: editingId, force: true })
        });
      }

      if (!res.ok) throw new Error(`update failed: ${res.status}`);

      editingId = null;
      editingUpdatedAt = "";
    editingUpdatedAtTs = 0;
      document.getElementById("submitBtn").innerText = "确定";
    }

    resetForm(false);
    await reloadAndRender();
    showToast("已保存到云端。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("保存失败：请检查网络或后端是否正常。", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = editingId === null ? "确定" : (oldText || "保存修改");
    }
  }
}

function getTodayLocalISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resetForm(resetEditing = true) {
  document.getElementById("ticketForm").reset();
  document.getElementById("date").value = getTodayLocalISO();
  document.getElementById("type").value = "日常故障";
  if (resetEditing) {
    editingId = null;
    editingUpdatedAt = "";
    editingUpdatedAtTs = 0;
    document.getElementById("submitBtn").innerText = "确定";
  }
}

function fillFormFromRecord(record) {
  if (!record) return;
  editingId = record.id;
  editingUpdatedAt = record.updated_at || "";
  editingUpdatedAtTs = Number(record.updated_at_ts || 0) || 0;
  document.getElementById("date").value = record.date || "";
  document.getElementById("issue").value = record.issue || "";
  document.getElementById("department").value = record.department || "";
  document.getElementById("name").value = record.name || "";
  document.getElementById("solution").value = record.solution || "";
  document.getElementById("remarks").value = record.remarks || "";
  document.getElementById("type").value = record.type || "日常故障";
  document.getElementById("submitBtn").innerText = "保存修改";
}

    function editRecord(id) {
      const record = records.find(r => r.id === id);
      if (!record) return;
      editingId = id;
      editingUpdatedAt = record.updated_at || "";
      editingUpdatedAtTs = Number(record.updated_at_ts || 0) || 0;
  editingUpdatedAtTs = Number(record.updated_at_ts || 0) || 0;
      document.getElementById("date").value = record.date || "";
      document.getElementById("issue").value = record.issue || "";
      document.getElementById("department").value = record.department || "";
      document.getElementById("name").value = record.name || "";
      document.getElementById("solution").value = record.solution || "";
      document.getElementById("remarks").value = record.remarks || "";
      document.getElementById("type").value = record.type || "日常故障";
      document.getElementById("submitBtn").innerText = "保存修改";
      openTicketModal(false);
    }


    

async function deleteRecord(id) {
  const ok = await showConfirm({
    title: "确认删除",
    message: "确认将这条工单移入回收站吗？\n\n你可以在【回收站】中恢复。",
    confirmText: "移入回收站",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;

  try {
    const res = await authedFetch(`/api/tickets/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);

    if (editingId === id) resetForm();
    await reloadAndRender();
    showToast("已移入回收站。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("删除失败：请检查网络或后端是否正常。", "error");
  }
}

async function restoreRecord(id) {
  const ok = await showConfirm({
    title: "恢复工单",
    message: "确认从回收站恢复这条工单吗？",
    confirmText: "恢复",
    cancelText: "取消",
    danger: false
  });
  if (!ok) return;
  try {
    const res = await authedFetch(`/api/tickets/${id}/restore`, { method: "PUT" });
    if (!res.ok) throw new Error(`restore failed: ${res.status}`);
    await reloadAndRender();
    showToast("已恢复该工单。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("恢复失败：请检查网络或后端是否正常。", "error");
  }
}

async function hardDeleteRecord(id) {
  const ok = await showConfirm({
    title: "彻底删除",
    message: "确认【彻底删除】这条记录吗？\n\n此操作不可恢复。",
    confirmText: "彻底删除",
    cancelText: "取消",
    danger: true
  });
  if (!ok) return;
  try {
    const res = await authedFetch(`/api/tickets/${id}/hard`, { method: "DELETE" });
    if (!res.ok) throw new Error(`hard delete failed: ${res.status}`);
    await reloadAndRender();
    showToast("已彻底删除。", "success");
  } catch (e) {
    if (isNoKeyError(e)) return;
    console.error(e);
    showToast("彻底删除失败：请检查网络或后端是否正常。", "error");
  }
}

    function clearFilters() {
      document.getElementById("filterFrom").value = "";
      document.getElementById("filterTo").value = "";
      document.getElementById("filterType").value = "";
      document.getElementById("filterKeyword").value = "";
      // 保留月份视图状态，仅清空高级筛选
      renderTable({ resetPage: true });
}

async function renderTable({ resetPage = true } = {}) {
  const tbody = document.getElementById("recordTable").querySelector("tbody");
  tbody.innerHTML = "";

  // 若筛选条件/视图变化，则清空游标分页状态
  const newCursorKey = buildCursorKey();
  if (resetPage || newCursorKey !== cursorKey) {
    cursorKey = newCursorKey;
    pageCursorMap.clear();
    cursorNav = null;
  }

  try {
    if (resetPage) currentPage = 1;
    await loadPageFromServer();
  } catch (e) {
    console.error(e);
    showToast("加载失败：请检查网络或后端是否正常。", "error");
    records = [];
    serverTotal = 0;
  }

  const totalItems = serverTotal;
  const pageRecords = records;

  if (pageRecords.length === 0) {
    const row = tbody.insertRow();
    const cell = row.insertCell(0);
    cell.colSpan = 8;
    cell.style.textAlign = "center";
    cell.style.color = "#999";
    cell.style.padding = "14px 8px";
    cell.innerText = viewMode === "trash" ? "回收站暂无记录" : "暂无工单记录";
  } else {
    pageRecords.forEach(r => {
      const row = tbody.insertRow();
      row.insertCell(0).innerText = r.date;
      row.insertCell(1).innerText = r.issue;
      row.insertCell(2).innerText = r.department;
      row.insertCell(3).innerText = r.name;
      row.insertCell(4).innerText = r.solution;
      row.insertCell(5).innerText = r.remarks;
      row.insertCell(6).innerText = r.type;
      const actionCell = row.insertCell(7);

      if (viewMode === "trash") {
        const restoreBtn = document.createElement("button");
        restoreBtn.innerText = "恢复";
        restoreBtn.className = "small";
        restoreBtn.onclick = () => restoreRecord(r.id);

        const hardBtn = document.createElement("button");
        hardBtn.innerText = "彻底删除";
        hardBtn.className = "small danger";
        hardBtn.onclick = () => hardDeleteRecord(r.id);

        actionCell.appendChild(restoreBtn);
        actionCell.appendChild(hardBtn);
      } else {
        const editBtn = document.createElement("button");
        editBtn.innerText = "编辑";
        editBtn.className = "small";
        editBtn.onclick = () => editRecord(r.id);

        const delBtn = document.createElement("button");
        delBtn.innerText = "删除";
        delBtn.className = "small danger";
        delBtn.onclick = () => deleteRecord(r.id);

        actionCell.appendChild(editBtn);
        actionCell.appendChild(delBtn);
      }
    });
  }

  // 统计/图表：基于服务端“当前视图（全部筛选结果）”
  try {
    const stats = await loadStatsFromServer();
    updateStatsAndChartsFromStats(stats);
  } catch (e) {
    console.warn(e);
  }

  refreshMonthButtons();
  renderPagination(totalItems);
}

function renderPagination(totalItems) {
  const el = document.getElementById("pagination");
  if (!el) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  currentPage = clamp(currentPage, 1, totalPages);

  el.innerHTML = "";

  const info = document.createElement("div");
  info.className = "page-info";
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalItems, currentPage * pageSize);
  info.textContent = `显示 ${start}-${end} / ${totalItems} 条`;

  const controls = document.createElement("div");
  controls.className = "page-controls";

  // 每页条数（上限 100）
  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = "每页：";
  const sizeSelect = document.createElement("select");
  sizeSelect.className = "page-size";
  [20, 50, 100].forEach(n => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} 条`;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.value = String(pageSize);
  sizeSelect.onchange = () => {
    pageSize = Math.min(Number(sizeSelect.value) || 100, PAGE_SIZE_MAX);
    renderTable({ resetPage: true });
  };

  function mkBtn(text, { disabled = false, active = false, onClick } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (active) b.classList.add("active");
    b.disabled = disabled;
    if (onClick) b.onclick = onClick;
    return b;
  }

  const firstBtn = mkBtn("首页", {
    disabled: currentPage <= 1 || totalItems === 0,
    onClick: () => { cursorNav = null; currentPage = 1; renderTable({ resetPage: true }); }
  });
  const prevBtn = mkBtn("上一页", {
    disabled: currentPage <= 1 || totalItems === 0,
    onClick: () => {
      const c = pageCursorMap.get(currentPage);
      if (c && c.prev_cursor) {
        cursorNav = { cursor: c.prev_cursor, direction: "prev" };
      } else {
        cursorNav = null;
      }
      currentPage -= 1;
      renderTable({ resetPage: false });
    }
  });
  const nextBtn = mkBtn("下一页", {
    disabled: currentPage >= totalPages || totalItems === 0,
    onClick: () => {
      const c = pageCursorMap.get(currentPage);
      if (c && c.next_cursor) {
        cursorNav = { cursor: c.next_cursor, direction: "next" };
      } else {
        cursorNav = null;
      }
      currentPage += 1;
      renderTable({ resetPage: false });
    }
  });
  const lastBtn = mkBtn("末页", {
    disabled: currentPage >= totalPages || totalItems === 0,
    onClick: () => { cursorNav = null; currentPage = totalPages; renderTable({ resetPage: false }); }
  });

  // 页码按钮（最多显示 7 个）
  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - 3);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  startPage = Math.max(1, endPage - maxButtons + 1);

  // 组合 UI
  controls.appendChild(sizeLabel);
  controls.appendChild(sizeSelect);
  controls.appendChild(firstBtn);
  controls.appendChild(prevBtn);

  for (let p = startPage; p <= endPage; p++) {
    controls.appendChild(mkBtn(String(p), {
      active: p === currentPage,
      disabled: totalItems === 0,
      onClick: () => { cursorNav = null; currentPage = p; renderTable({ resetPage: false }); }
    }));
  }

  controls.appendChild(nextBtn);
  controls.appendChild(lastBtn);

  // 跳转
  const jump = document.createElement("input");
  jump.type = "number";
  jump.min = "1";
  jump.max = String(totalPages);
  jump.placeholder = "页码";
  jump.value = "";
  jump.onkeydown = (e) => {
    if (e.key === "Enter") {
      const p = clamp(Number(jump.value) || 1, 1, totalPages);
      cursorNav = null;
      currentPage = p;
      renderTable({ resetPage: false });
      jump.value = "";
    }
  };

  const jumpBtn = mkBtn("跳转", {
    disabled: totalItems === 0,
    onClick: () => {
      const p = clamp(Number(jump.value) || 1, 1, totalPages);
      cursorNav = null;
      currentPage = p;
      renderTable({ resetPage: false });
      jump.value = "";
    }
  });

  controls.appendChild(jump);
  controls.appendChild(jumpBtn);

  el.appendChild(info);
  el.appendChild(controls);
}

    function refreshYearOptions() {
      const yearSelect = document.getElementById("yearSelect");
      const oldValue = activeYear;
      const years = Array.from(
        new Set(
          Object.keys(metaMonthCounts || {})
            .map(k => String(k).slice(0, 4))
            .filter(Boolean)
        )
      ).sort();
      yearSelect.innerHTML = '<option value="">全部年份</option>';
      years.forEach(y => {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
      });
      if (oldValue && years.includes(oldValue)) {
        activeYear = oldValue;
        yearSelect.value = oldValue;
      } else {
        activeYear = "";
        yearSelect.value = "";
        activeMonth = "";
      }
      refreshMonthButtons();
    }

    function refreshMonthButtons() {
      const container = document.getElementById("monthButtons");
      container.innerHTML = "";

      const year = activeYear;
      const monthsHasData = {};
      Object.keys(metaMonthCounts || {}).forEach(key => {
        const y = String(key).slice(0, 4);
        const m = String(key).slice(5, 7);
        if (!m) return;
        if (!year || y === year) monthsHasData[m] = true;
      });

      // 若当前月份在该年份下无数据，则自动回到“全部月份”
      if (activeMonth && !monthsHasData[activeMonth]) {
        activeMonth = "";
        saveViewState();
      }

      for (let i = 1; i <= 12; i++) {
        const m = String(i).padStart(2, "0");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "month-btn";
        btn.textContent = i + "月";

        const hasData = monthsHasData[m];
        if (!hasData) {
          btn.classList.add("disabled");
          btn.onclick = null;
        } else {
          btn.onclick = () => setActiveMonth(m);
        }
        if (activeMonth === m) {
          btn.classList.add("active");
        }
        container.appendChild(btn);
      }

      // 增加一个“全部月份”按钮
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "month-btn";
      allBtn.textContent = "全部月份";
      if (!activeMonth) {
        allBtn.classList.add("active");
      }
      allBtn.onclick = () => {
        activeMonth = "";
        saveViewState();
        renderTable();
      };
      container.appendChild(allBtn);
    }

    function onYearChange() {
      const select = document.getElementById("yearSelect");
      activeYear = select.value;
      activeMonth = ""; // 切换年份时重置月份
      saveViewState();
      renderTable();
    }

    function setActiveMonth(m) {
      if (activeMonth === m) {
        activeMonth = ""; // 再次点击可取消
      } else {
        activeMonth = m;
      }
      saveViewState();
      renderTable();
    }

    function updateStatsAndChartsFromStats(stats) {
      const totalAll = Number(stats?.total_all ?? metaTotalAll ?? 0) || 0;
      const totalFiltered = Number(stats?.total_filtered ?? serverTotal ?? 0) || 0;

      const countsByType = (stats && stats.type_counts) ? stats.type_counts : {};
      const countsByMonth = (stats && stats.month_counts) ? stats.month_counts : {};

      // ===== 概览卡片 =====
      const typeKinds = Object.keys(countsByType).length;
      const topType = Object.entries(countsByType).sort((a,b) => b[1]-a[1])[0]?.[0] || "-";
      const topTypeCount = Object.entries(countsByType).sort((a,b) => b[1]-a[1])[0]?.[1] || 0;

      const cardsEl = document.getElementById("statsCards");
      if (cardsEl) {
        cardsEl.innerHTML = `
          <div class="stat">
            <div class="label">当前视图工单数</div>
            <div class="value">${totalFiltered}</div>
            <div class="sub">已应用筛选 + 年/月视图</div>
          </div>
          <div class="stat">
            <div class="label">全部记录数</div>
            <div class="value">${totalAll}</div>
            <div class="sub">当前模式总量（${viewMode === "trash" ? "回收站" : "工单"}）</div>
          </div>
          <div class="stat">
            <div class="label">类型数量</div>
            <div class="value">${typeKinds}</div>
            <div class="sub">Top：${escapeHtml(topType)}（${topTypeCount}）</div>
          </div>
        `;
      }

      // 兼容：老版本页面的 #stats（如果存在就也填一下，避免空白）
      const statsEl = document.getElementById("stats");
      if (statsEl) {
        statsEl.innerHTML = `<div class="muted">全部记录：${totalAll} 条；当前视图：${totalFiltered} 条。</div>`;
      }

      // ===== 颜色生成 =====
      function genColors(n) {
        const out = [];
        const base = 210; // 蓝系起点
        for (let i = 0; i < n; i++) {
          const hue = (base + i * (360 / Math.max(1, n))) % 360;
          out.push(`hsl(${hue} 75% 55%)`);
        }
        return out;
      }

      // ===== 自定义图例 =====
      function renderLegend(labels, values, colors) {
        const legend = document.getElementById("typeLegend");
        if (!legend) return;
        if (!labels.length) {
          legend.innerHTML = `<div class="muted">暂无数据</div>`;
          return;
        }
        const sum = values.reduce((a,b) => a + b, 0) || 1;
        legend.innerHTML = labels.map((name, idx) => {
          const v = values[idx] || 0;
          const pct = Math.round((v / sum) * 1000) / 10; // 1 位小数
          return `
            <div class="legend-item" title="${escapeHtml(name)}">
              <span class="legend-swatch" style="background:${colors[idx]};"></span>
              <span class="legend-name">${escapeHtml(name)}</span>
              <span class="legend-meta">
                <span class="legend-count">${v}</span>
                <span class="legend-pct">${pct}%</span>
              </span>
            </div>
          `;
        }).join("");
      }

      // ===== 饼图（类型分布）=====
      const pieLabels = Object.keys(countsByType);
      const pieData = pieLabels.map(l => Number(countsByType[l]) || 0);
      const pieColors = genColors(pieLabels.length);

      if (typePieChart) typePieChart.destroy();
      const pieCanvas = document.getElementById("typePieChart");
      if (pieCanvas) {
        const pieCtx = pieCanvas.getContext("2d");
        typePieChart = new Chart(pieCtx, {
          type: "pie",
          data: {
            labels: pieLabels,
            datasets: [{
              data: pieData,
              backgroundColor: pieColors,
            radius: "80%",
              borderColor: "#ffffff",
              borderWidth: 2,
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 36, right: 44, bottom: 44, left: 44 } },
            plugins: {
              legend: { display: false },
              
// 标签太多时外侧文字会重叠：改为“仅显示较大扇区的百分比”，其余信息放到右侧图例/悬浮提示中
datalabels: {
  color: "#fff",
  font: { size: 12, weight: "700" },
  textAlign: "center",
  anchor: "center",
  align: "center",
  offset: 0,
  clamp: true,
  clip: true,
  display: (ctx) => {
    const arr = ctx.dataset?.data || [];
    const value = Number(arr[ctx.dataIndex] ?? 0);
    const sum = arr.reduce((a,b)=>a+Number(b||0),0) || 1;
    const pct = value / sum;
    // 显示规则：>= 8% 的扇区一定显示；否则仅显示“前 5 大”的扇区，避免满屏文字
    let higher = 0;
    for (const v of arr) if (Number(v||0) > value) higher++;
    const isTop5 = higher < 5;
    return pct >= 0.08 || isTop5;
  },
  formatter: (value, ctx) => {
    const arr = ctx.dataset?.data || [];
    const sum = arr.reduce((a,b)=>a+Number(b||0),0) || 1;
    const pct = Math.round((Number(value||0)/sum)*1000)/10;
    return `${pct}%`;
  }
},
tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const v = ctx.parsed ?? 0;
                    const sum = pieData.reduce((a,b)=>a+b,0) || 1;
                    const pct = Math.round((v/sum)*1000)/10;
                    return `${ctx.label}: ${v}（${pct}%）`;
                  }
                }
              }
            }
          }
        });
      }
      renderLegend(pieLabels, pieData, pieColors);

      // ===== 柱状图（按月份数量）=====
      const monthKeys = Object.keys(countsByMonth).sort();
      const barLabels = monthKeys;
      const barData = monthKeys.map(k => Number(countsByMonth[k]) || 0);

      if (monthBarChart) monthBarChart.destroy();
      const barCanvas = document.getElementById("monthBarChart");
      if (barCanvas) {
        const barCtx = barCanvas.getContext("2d");
        monthBarChart = new Chart(barCtx, {
          type: "bar",
          data: {
            labels: barLabels,
            datasets: [{
              label: "工单数量",
              data: barData,
              borderWidth: 1,
              borderRadius: 6,
              maxBarThickness: 36
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: (items) => items?.[0]?.label || "",
                  label: (ctx) => `数量：${ctx.parsed.y ?? 0}`
                }
              }
            },
            scales: {
              x: { title: { display: true, text: "月份" }, grid: { display: false } },
              y: { title: { display: true, text: "工单数量" }, beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(0,0,0,0.06)" } }
            }
          }
        });
      }
    }


    
    // 生成「故障类型统计」Sheet：
    // - 默认：直接写入统计数值
    // - 若提供 dataSheetName：使用 Excel 公式（COUNTIF）动态统计（用户在 Excel 里改类型也会自动更新）
    function buildTypeStatsSheet(arr, dataSheetName) {
      const map = {};
      const safeArr = Array.isArray(arr) ? arr : [];
      safeArr.forEach(r => {
        const t = (r && r.type != null ? String(r.type) : "").trim() || "未分类";
        map[t] = (map[t] || 0) + 1;
      });

      const types = Object.entries(map).sort((a, b) => b[1] - a[1]).map(([t]) => t);
      const rows = [["故障类型", "数量", "占比"]];
      types.forEach(t => rows.push([t, null, null]));
      rows.push(["合计", null, null]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }];

      const totalRowIdx = rows.length; // 1-based in Excel
      const firstDataRowIdx = 2;
      const lastTypeRowIdx = totalRowIdx - 1;

      if (dataSheetName) {
        // 类型列在第 7 列（G列）
        const typeRange = `'${dataSheetName.replace(/'/g, "''")}'!$G:$G`;

        for (let i = 0; i < types.length; i++) {
          const r = firstDataRowIdx + i; // Excel row number
          // B列数量：COUNTIF
          const cellB = XLSX.utils.encode_cell({ r: r - 1, c: 1 });
          ws[cellB] = ws[cellB] || { t: "n" };
          ws[cellB].f = `COUNTIF(${typeRange},A${r})`;

          // C列占比：B/合计
          const cellC = XLSX.utils.encode_cell({ r: r - 1, c: 2 });
          ws[cellC] = ws[cellC] || { t: "n" };
          ws[cellC].f = `IF($B$${totalRowIdx}=0,0,B${r}/$B$${totalRowIdx})`;
          ws[cellC].z = "0.0%";
        }

        // 合计行
        const totalB = XLSX.utils.encode_cell({ r: totalRowIdx - 1, c: 1 });
        ws[totalB] = ws[totalB] || { t: "n" };
        ws[totalB].f = `SUM(B${firstDataRowIdx}:B${lastTypeRowIdx})`;

        const totalC = XLSX.utils.encode_cell({ r: totalRowIdx - 1, c: 2 });
        ws[totalC] = ws[totalC] || { t: "n" };
        ws[totalC].f = `IF($B$${totalRowIdx}=0,0,1)`;
        ws[totalC].z = "0.0%";
      } else {
        // 静态写值（用于多 Sheet 汇总，避免跨 Sheet 公式复杂）
        const total = safeArr.length || 0;
        for (let i = 0; i < types.length; i++) {
          const t = types[i];
          const c = map[t] || 0;
          const row = firstDataRowIdx + i;

          const cellB = XLSX.utils.encode_cell({ r: row - 1, c: 1 });
          ws[cellB] = { t: "n", v: c };

          const cellC = XLSX.utils.encode_cell({ r: row - 1, c: 2 });
          ws[cellC] = { t: "n", v: total ? c / total : 0, z: "0.0%" };
        }
        const totalB = XLSX.utils.encode_cell({ r: totalRowIdx - 1, c: 1 });
        ws[totalB] = { t: "n", v: total };

        const totalC = XLSX.utils.encode_cell({ r: totalRowIdx - 1, c: 2 });
        ws[totalC] = { t: "n", v: total ? 1 : 0, z: "0.0%" };
      }

      return ws;
    }

    // ====== 导出/备份：按分页把全量数据拉下来 ======
    async function fetchAllTicketsByParams(spBase, { maxPages = 2000 } = {}) {
      const sp = new URLSearchParams(spBase.toString());
      const ps = Math.min(Number(sp.get("pageSize") || pageSize) || 100, PAGE_SIZE_MAX);
      sp.set("pageSize", String(ps));

      let page = 1;
      let total = 0;
      let all = [];

      while (page <= maxPages) {
        sp.set("page", String(page));
        const res = await authedFetch(`/api/tickets?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`export load failed: ${res.status}`);
        const j = await res.json();
        const arr = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);
        if (!total) total = Number(j?.total ?? arr.length) || 0;

        all = all.concat(arr);
        if (all.length >= total) break;
        if (arr.length === 0) break;
        page += 1;
      }

      return normalizeRecords(all);
    }

    // 导出当前筛选为单 Sheet Excel
    async function exportExcelCurrent() {
      try {
        showToast("正在导出当前筛选...", "info");
        const sp = buildFilters({ includeYearMonth: true });
        sp.set("pageSize", String(PAGE_SIZE_MAX));
        const filtered = await fetchAllTicketsByParams(sp);
        if (filtered.length === 0) {
          showToast("当前视图下没有可导出的记录！", "warning");
          return;
        }

        const data = [["日期", "问题", "部门", "姓名", "处理方法", "备注", "类型" ]];
        filtered.forEach(r => {
          data.push([r.date, r.issue, r.department, r.name, r.solution, r.remarks, r.type]);
        });
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "工单记录");
      
      // 追加：故障类型统计
      const wsStats = buildTypeStatsSheet(filtered, "工单记录");
      XLSX.utils.book_append_sheet(wb, wsStats, "类型统计");

        XLSX.writeFile(wb, "工单记录_当前视图.xlsx");
        showToast("导出成功！", "success");
      } catch (e) {
        console.error(e);
        showToast("导出失败：请检查网络或后端是否正常。", "error");
      }
    }

    // 按月份分 Sheet 导出 Excel（基于全部 records，按 yyyy-MM 分页）
    async function exportExcelByMonth() {
      try {
        showToast("正在导出全量数据（按月份分 Sheet）...", "info");
        // 按“工单”全量导出（不区分你当前是否在回收站视图）
        const sp = new URLSearchParams();
        sp.set("pageSize", String(PAGE_SIZE_MAX));
        const allActive = await fetchAllTicketsByParams(sp);
        if (allActive.length === 0) {
          showToast("没有可导出的数据！", "warning");
          return;
        }

      const grouped = {};
      allActive.forEach(r => {
        const monthKey = r.date.slice(0, 7); // yyyy-MM
        if (!grouped[monthKey]) grouped[monthKey] = [];
        grouped[monthKey].push(r);
      });
      const wb = XLSX.utils.book_new();
      Object.keys(grouped).sort().forEach(monthKey => {
        const arr = grouped[monthKey];
        const data = [["日期", "问题", "部门", "姓名", "处理方法", "备注", "类型" ]];
        arr.forEach(r => {
          data.push([r.date, r.issue, r.department, r.name, r.solution, r.remarks, r.type]);
        });
        const ws = XLSX.utils.aoa_to_sheet(data);
        const sheetName = monthKey.replace("-", ""); // 202501
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      
      // 追加：故障类型统计（全量 active）
      const wsStats = buildTypeStatsSheet(allActive);
      XLSX.utils.book_append_sheet(wb, wsStats, "类型统计");

      XLSX.writeFile(wb, "工单记录_按月份多Sheet.xlsx");
      showToast("导出成功！", "success");
      } catch (e) {
        console.error(e);
        showToast("导出失败：请检查网络或后端是否正常。", "error");
      }
    }

    // 导出 JSON 备份（包含：工单 + 回收站）
    async function backupData() {
      try {
        showToast("正在导出备份（含回收站）...", "info");
        const spActive = new URLSearchParams();
        spActive.set("pageSize", String(PAGE_SIZE_MAX));
        const spTrash = new URLSearchParams();
        spTrash.set("trash", "1");
        spTrash.set("pageSize", String(PAGE_SIZE_MAX));

        // GET 不需要口令
        const [active, trash] = await Promise.all([
          fetchAllTicketsByParams(spActive),
          fetchAllTicketsByParams(spTrash).catch(() => []),
        ]);

        const payload = {
          exported_at: new Date().toISOString(),
          active,
          trash,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "工单备份_含回收站.json";
        link.click();
        URL.revokeObjectURL(url);
        showToast("备份成功！已下载 JSON 文件。", "success");
      } catch (e) {
        console.error(e);
        showToast("备份失败：请检查网络或后端是否正常。", "error");
      }
    }

    
    // 载入 JSON 备份（兼容多种导出格式）
    
// 载入 JSON 备份（兼容多种导出格式）
function loadBackup(event) {
  const input = event.target;
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const raw = e.target.result;
      const parsed = JSON.parse(raw);

      // 新格式：{ active: [...], trash: [...] }
      let importedPayload = null;
      if (parsed && typeof parsed === "object" && (Array.isArray(parsed.active) || Array.isArray(parsed.trash))) {
        importedPayload = {
          active: Array.isArray(parsed.active) ? parsed.active : [],
          trash: Array.isArray(parsed.trash) ? parsed.trash : [],
        };
      }

      // 1) 最常见：直接是数组
      let imported = null;

      if (importedPayload) {
        // 本地展示默认导入到当前视图（工单/回收站）
        imported = viewMode === "trash" ? importedPayload.trash : importedPayload.active;
      }

      if (!importedPayload && Array.isArray(parsed)) {
        imported = parsed;
      } else if (!importedPayload && parsed && typeof parsed === "object") {
        // 2) 兼容：{ records: [...] } / { data: [...] } / { tickets: [...] }
        const candidate =
          (Array.isArray(parsed.records) && parsed.records) ||
          (Array.isArray(parsed.data) && parsed.data) ||
          (Array.isArray(parsed.tickets) && parsed.tickets) ||
          (Array.isArray(parsed.items) && parsed.items);

        if (candidate) {
          imported = candidate;
        } else {
          // 3) 兼容：按月份对象 { "2025-12": [ ... ], "2025-11": [ ... ] }
          const keys = Object.keys(parsed);
          const monthLike = keys.some(k => /^\d{4}-\d{2}$/.test(k) && Array.isArray(parsed[k]));
          if (monthLike) {
            imported = [];
            keys.sort().forEach(k => {
              if (Array.isArray(parsed[k])) imported = imported.concat(parsed[k]);
            });
          }
        }
      }

      if (!Array.isArray(imported)) {
        showToast("备份格式不正确：请导入通过本系统导出的 JSON 备份文件。", "error");
        return;
      }

      const normImported = normalizeRecords(imported);
      const normPayload = importedPayload ? {
        active: normalizeRecords(importedPayload.active),
        trash: normalizeRecords(importedPayload.trash),
      } : null;

      // 询问：导入到云端（共享）还是仅导入本地（当前浏览器）
      const toCloud = await showConfirm({
        title: "导入备份",
        message:
          `建议使用【合并导入】（不清空云端）。\n\n合并规则：仅当备份记录的 updated_at 更新更晚时才覆盖云端同 id 记录。\n\n- 确认：合并到云端（安全）\n- 取消：仅导入本地（只影响你当前浏览器）`,
        confirmText: "合并到云端",
        cancelText: "仅本地导入",
        danger: false
      });

      if (toCloud) {
        // 1) 先预演（Dry-run），给出变更摘要
        const previewRes = await authedFetch("/api/import/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normPayload || normImported)
        });
        if (!previewRes.ok) throw new Error(`import preview failed: ${previewRes.status}`);
        const preview = await previewRes.json();
        const t = preview && preview.totals ? preview.totals : null;

        const msg = window.TicketImportPreview ? window.TicketImportPreview.format(preview) : `预演结果：新增 ${t?.inserts || 0} 条，更新 ${t?.updates || 0} 条，跳过 ${t?.skips || 0} 条。`;

        const apply = await showConfirm({
          title: "导入预演（安全合并）",
          message: msg,
          confirmText: "应用导入",
          cancelText: "取消",
          danger: false
        });

        if (!apply) {
          showToast("已取消导入。", "info");
          return;
        }

        // 2) 应用导入
        const applyRes = await authedFetch("/api/import/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normPayload || normImported)
        });
        if (!applyRes.ok) throw new Error(`import apply failed: ${applyRes.status}`);

        // 读取后端统计（用于提示/智能切换视图）
        let applyJson = null;
        try { applyJson = await applyRes.json(); } catch {}

        // 先按当前视图刷新一次
        await reloadAndRender();

        // 友好提示（增强：解释“版本更新/相同导致跳过”）
        const t2 = applyJson && applyJson.totals ? applyJson.totals : null;
        if (t2) {
          const inserts = Number(t2.inserts || 0);
          const updates = Number(t2.updates || 0);
          const skips = Number(t2.skips || 0);
          const newerEq = Number(t2.skipped_newer_or_equal || 0);

          // 基础结果
          let msg = `导入完成：新增 ${inserts} 条，更新 ${updates} 条，跳过 ${skips} 条（active ${t2.active} / trash ${t2.trash}）`;

          // 解释性补充：云端版本更近/相同 → 跳过（保护线上数据）
          if (newerEq > 0) {
            msg += `；其中 ${newerEq} 条因云端版本更新/相同已跳过（保护线上数据）`;
          }

          // 如果本次完全没有写入，给更清晰的提示
          if (inserts + updates === 0 && skips > 0) {
            showToast(msg, "info");
          } else {
            showToast(msg, "success");
          }
        } else {
          showToast("已合并导入到云端（未清空）。", "success");
        }

        // 如果当前在工单视图但刷新后为空，而导入里包含回收站数据，则提示切到回收站查看
        if (viewMode !== "trash" && records.length === 0 && t2 && Number(t2.trash || 0) > 0) {
          const goTrash = await showConfirm({
            title: "导入完成，但当前列表为空",
            message: `备份中包含回收站记录 ${t2.trash} 条。\n\n是否切换到【回收站】查看/恢复？\n（提示：年份/月筛选也可能导致列表为空）`,
            confirmText: "切换到回收站",
            cancelText: "保持当前视图",
            danger: false
          });
          if (goTrash) {
            viewMode = "trash";
            saveViewState();
            await reloadAndRender();
          }
        }
      } else {
        records = normImported;
        const allForMax = normPayload ? normPayload.active.concat(normPayload.trash) : records;
        const maxId = allForMax.reduce((max, r) => {
          const v = Number(r.id);
          return Number.isFinite(v) ? Math.max(max, v) : max;
        }, 0);
        nextId = maxId + 1;
        currentPage = 1;
        refreshYearOptions();
        renderTable();
        saveToLocal();
        showToast(`已导入到本地（共 ${records.length} 条，仅本浏览器）！`, "success");
      }
    } catch (err) {
      if (isNoKeyError(err)) return;
      console.error(err);
      if (err instanceof SyntaxError) {
        showToast("解析备份失败：文件不是有效的 JSON。", "error");
      } else {
        showToast("导入失败：请检查备份文件或后端是否正常。", "error");
      }
    } finally {
      if (input) input.value = "";
    }
  };

  reader.onerror = function() {
    showToast("读取文件失败，请重试。", "error");
    if (input) input.value = "";
  };

  reader.readAsText(file);
}

    // 按月份导出 JSON（每个月一个独立 JSON 文件）
    function archiveByMonthJSON() {
      if (records.length === 0) {
        showToast("没有可归档的数据！", "warning");
        return;
      }
      const groups = {};
      records.forEach(r => {
        const monthKey = r.date.slice(0, 7); // yyyy-MM
        if (!groups[monthKey]) groups[monthKey] = [];
        groups[monthKey].push(r);
      });
      Object.keys(groups).sort().forEach(monthKey => {
        const data = groups[monthKey];
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `工单_${monthKey}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
      showToast("所有月份已分别导出为独立 JSON 文件！", "success");
    }

    // 年度 ZIP 打包：所有月份 JSON 文件打包为一个 ZIP
    function exportYearZip() {
      if (records.length === 0) {
        showToast("没有可打包的数据！", "warning");
        return;
      }
      const zip = new JSZip();
      const groups = {};
      records.forEach(r => {
        const monthKey = r.date.slice(0, 7); // yyyy-MM
        if (!groups[monthKey]) groups[monthKey] = [];
        groups[monthKey].push(r);
      });
      Object.keys(groups).sort().forEach(monthKey => {
        const data = groups[monthKey];
        const content = JSON.stringify(data, null, 2);
        zip.file(`工单_${monthKey}.json`, content);
      });
      zip.generateAsync({ type: "blob" }).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "工单年度归档.zip";
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // 初始化
    
(async function init() {
  try { updateEditKeyStatus(); } catch (e) {}
  try { if (window.TicketHealth) { const health = await window.TicketHealth.load(); window.TicketHealth.render(health); } } catch (e) { console.warn(e); if (window.TicketHealth) window.TicketHealth.render({ ok:false }); }

  // 先恢复月份视图（只影响筛选/显示，不影响数据源）
  loadViewState();

  // 恢复视图模式（工单 / 回收站）
  loadViewMode();
  updateViewModeUI();

  // 先尝试从云端加载（多人共享数据）
  try {
    await reloadAndRender({ showLoadedToast: false });
  } catch (e) {
    console.error(e);
    // 云端失败时用本地缓存兜底
    loadFromLocal();
    refreshYearOptions();
    renderTable();
    showToast("云端加载失败，已使用本地缓存（仅本浏览器）。", "warning");
  }
})();
  

  // 手动选择目录并导出 JSON 备份（使用统一 Toast 提示）
  async function manualBackup() {
    if (!window.showDirectoryPicker) {
      showToast("当前浏览器不支持目录访问 API，建议使用最新版的 Edge/Chrome。", "warning");
      return;
    }
    if (!records || records.length === 0) {
      showToast("当前没有可备份的数据！", "warning");
      return;
    }

    try {
      const dir = await window.showDirectoryPicker();
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const fileName = `工单备份_${today}.json`;
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(records, null, 2));
      await writable.close();

      showToast("备份成功！", "success");
    } catch (e) {
      if (e && e.name === "AbortError") {
        // 用户取消选择，静默即可
        return;
      }
      console.error(e);
      showToast("备份失败！", "error");
    }
  }
