(function () {
  async function load() {
    const headers = new Headers({ 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' });
    const key = (window.TicketAuth && typeof window.TicketAuth.get === 'function')
      ? window.TicketAuth.get()
      : (typeof window.getEditKey === 'function' ? window.getEditKey() : '');
    if (key) headers.set('X-EDIT-KEY', key);
    const res = await fetch('/api/health', { cache: 'no-store', headers });
    if (!res.ok) throw new Error(`health failed: ${res.status}`);
    return await res.json();
  }

  function render(data) {
    const el = document.getElementById('healthSummary');
    const pill = document.getElementById('healthStatusPill');
    if (!el) return;
    if (!data || !data.ok) {
      if (pill) {
        pill.classList.remove('on');
        pill.classList.add('off');
        pill.textContent = '异常';
      }
      el.innerHTML = '<span class="pill off">异常</span> 健康检查失败';
      return;
    }
    if (pill) {
      pill.classList.remove('off');
      pill.classList.add('on');
      pill.textContent = '正常';
    }
    const dict = data.dictionaries?.ticket_types || {};
    el.innerHTML = [
      `<span class="pill on">正常</span>`,
      `Schema ${data.schema?.current}/${data.schema?.latest}`,
      `工单 ${data.counts?.tickets ?? 0}`,
      `回收站 ${data.counts?.deleted ?? 0}`,
      `FTS ${data.fts?.exists ? '已启用' : '未启用'}`,
      `类型字典 ${dict.exists ? `${dict.enabled ?? 0}/${dict.total ?? 0}` : '未初始化'}`,
      `检查时间 ${data.now ? formatISOToLocal(data.now) : '-'}`,
    ].join(' &nbsp; ');
  }

  async function refresh() {
    const btn = document.getElementById('btnRefreshHealth');
    const summary = document.getElementById('healthSummary');
    const oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = '检查中…';
    }
    if (summary) summary.setAttribute('aria-busy', 'true');
    try {
      const data = await load();
      render(data);
      if (typeof showToast === 'function') showToast('系统健康检查已刷新。', 'success');
      return data;
    } catch (e) {
      console.warn(e);
      render({ ok: false });
      if (typeof showToast === 'function') showToast('系统健康检查失败，请确认已设置管理员口令。', 'error');
      return null;
    } finally {
      if (summary) summary.setAttribute('aria-busy', 'false');
      if (btn) {
        btn.disabled = false;
        btn.setAttribute('aria-busy', 'false');
        btn.textContent = oldText || '刷新检查';
      }
    }
  }

  function bind() {
    const btn = document.getElementById('btnRefreshHealth');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', refresh);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.TicketHealth = { load, render, refresh, bind };
})();
