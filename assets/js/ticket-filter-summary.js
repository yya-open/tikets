/**
 * 筛选状态摘要条（只读视图 · 零业务耦合）
 *
 * 目的：
 *   给用户一个"当前视图看到的是哪一批工单"的即时反馈条，避免高级筛选被折叠后，
 *   用户忘记自己开启了某个筛选而误判数据。
 *
 * 数据流：
 *   renderTable() 每次结束都会重写 #pagination 的 innerHTML
 *     └─ MutationObserver 监听 #pagination
 *          └─ readFilters()（复用 window.TicketQueryState.readFilters）
 *               └─ 渲染 #filterSummary 内容 + 更新 data-empty
 *
 * 交互：
 *   #filterSummaryClear 点击 → 委托给现有 #btnClearFilters + 快捷筛选回到"全部"，
 *   不引入任何独立的清空逻辑，保持"单一真相源"。
 */
(function () {
  var QUICK_LABELS = {
    open: '未完成',
    overdue: '已超期',
    today: '今日新增',
    unassigned: '未指派',
  };

  var CHIP_ORDER = [
    { key: 'ticketStatus', label: '状态' },
    { key: 'priority',     label: '优先级' },
    { key: 'type',         label: '类型' },
    { key: 'assignee',     label: '负责人' },
    { key: 'department',   label: '部门' },
    { key: 'name',         label: '姓名' },
    { key: 'q',            label: '关键字' },
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 从 QueryState 读筛选；带 fallback 到直接 DOM 读，防止脚本加载顺序抖动
  function readFiltersSafe() {
    try {
      if (window.TicketQueryState && typeof window.TicketQueryState.readFilters === 'function') {
        return window.TicketQueryState.readFilters();
      }
    } catch (_) {}
    return {};
  }

  // 把 filters 对象翻译成 chip 列表：[{ key, value, cls? }]
  function buildChips(f) {
    var chips = [];

    if (Number(f.trash || 0) === 1) {
      chips.push({ key: '视图', value: '回收站', cls: 'filter-chip-trash' });
    }

    if (f.year) {
      chips.push({ key: '年月', value: f.month ? (f.year + '-' + f.month) : f.year });
    }

    if (f.from || f.to) {
      var range = (f.from || '…') + ' ~ ' + (f.to || '…');
      chips.push({ key: '日期', value: range });
    }

    if (f.quick && QUICK_LABELS[f.quick]) {
      chips.push({ key: '快捷', value: QUICK_LABELS[f.quick] });
    }

    CHIP_ORDER.forEach(function (item) {
      var v = f[item.key];
      if (v && String(v).trim()) {
        chips.push({ key: item.label, value: String(v).trim() });
      }
    });

    return chips;
  }

  function renderChip(chip) {
    var cls = 'filter-chip' + (chip.cls ? ' ' + chip.cls : '');
    return '<span class="' + cls + '">'
      +    '<span class="filter-chip-key">' + escapeHtml(chip.key) + '：</span>'
      +    '<span class="filter-chip-value">' + escapeHtml(chip.value) + '</span>'
      +  '</span>';
  }

  function syncSummary() {
    var host = document.getElementById('filterSummary');
    var slot = document.getElementById('filterSummaryChips');
    if (!host || !slot) return;

    var filters = readFiltersSafe();
    var chips = buildChips(filters);

    if (chips.length === 0) {
      slot.innerHTML = '';
      host.setAttribute('data-empty', '1');
      host.setAttribute('hidden', '');
      return;
    }

    slot.innerHTML = chips.map(renderChip).join('');
    host.removeAttribute('data-empty');
    host.removeAttribute('hidden');
  }

  // 清空：委托给现有清空按钮 + 让快捷筛选回到"全部"
  function bindClear() {
    var btn = document.getElementById('filterSummaryClear');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var quickAll = document.querySelector('#quickFilterGroup [data-quick-filter="all"]');
      if (quickAll && !quickAll.classList.contains('active')) {
        quickAll.click();
      }
      var clear = document.getElementById('btnClearFilters');
      if (clear) clear.click();
    });
  }

  // 监听 #pagination 变更作为"渲染完成"信号；#pagination 每次 renderTable 都会被重写
  function observePagination() {
    var target = document.getElementById('pagination');
    if (!target) return false;
    var mo = new MutationObserver(function () {
      // 使用 rAF 合并同一帧内的多次变更
      if (mo._raf) return;
      mo._raf = requestAnimationFrame(function () {
        mo._raf = 0;
        syncSummary();
      });
    });
    mo.observe(target, { childList: true, subtree: true });
    return true;
  }

  function init() {
    bindClear();
    // 首屏也刷一次；即使还没数据，也能反映高级筛选默认值 / 年月视图
    syncSummary();

    if (!observePagination()) {
      // #pagination 尚未挂载：延迟一次再试
      setTimeout(function () {
        observePagination();
        syncSummary();
      }, 300);
    }

    // 对表单变化也做一次即时反馈（不强求，仅提升响应）
    ['filterFrom', 'filterTo', 'filterType', 'filterTicketStatus', 'filterPriority',
     'filterAssignee', 'filterKeyword'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.dataset.summaryBound !== '1') {
        el.dataset.summaryBound = '1';
        el.addEventListener('change', syncSummary);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();