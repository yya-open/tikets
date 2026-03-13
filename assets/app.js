    var records = [];
    var editingId = null;
    var editingUpdatedAt = ""; // legacy concurrency token from server
    var editingUpdatedAtTs = 0; // preferred concurrency token (ms timestamp)
    var nextId = 1;

    window.TicketAppState = window.TicketAppState || {};
    Object.defineProperties(window.TicketAppState, {
      records: { get: () => records, set: (v) => { records = Array.isArray(v) ? v : []; } },
      editingId: { get: () => editingId, set: (v) => { editingId = v; } },
      editingUpdatedAt: { get: () => editingUpdatedAt, set: (v) => { editingUpdatedAt = v || ""; } },
      editingUpdatedAtTs: { get: () => editingUpdatedAtTs, set: (v) => { editingUpdatedAtTs = Number(v || 0) || 0; } },
      nextId: { get: () => nextId, set: (v) => { nextId = Number(v || 1) || 1; } },
      viewMode: { get: () => viewMode, set: (v) => { viewMode = (v === "trash") ? "trash" : "active"; } },
      pageSize: { get: () => pageSize, set: (v) => { pageSize = Number(v || 100) || 100; } },
      currentPage: { get: () => currentPage, set: (v) => { currentPage = Number(v || 1) || 1; } }
    });

    // ===== Chart 插件：在饼图外显示标签（类型/数量/占比）=====
    // 依赖 chartjs-plugin-datalabels（已在 <head> 引入）
    if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
      try { Chart.register(ChartDataLabels); } catch (e) {}
    }


    // ===== 视图模式：工单 / 回收站 =====
    const VIEW_MODE_STORAGE = "ticket_view_mode";
    var viewMode = "active"; // 'active' | 'trash'

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
