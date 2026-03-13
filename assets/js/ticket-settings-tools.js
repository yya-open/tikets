// ===== 一键初始化 / 自检 =====
var __oneClickLast = null;

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

