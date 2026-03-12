(function () {
  async function load() {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`health failed: ${res.status}`);
    return await res.json();
  }

  function render(data) {
    const el = document.getElementById('healthSummary');
    if (!el) return;
    if (!data || !data.ok) {
      el.innerHTML = '<span class="pill off">异常</span> 健康检查失败';
      return;
    }
    el.innerHTML = [
      `<span class="pill on">正常</span>`,
      `Schema ${data.schema?.current}/${data.schema?.latest}`,
      `工单 ${data.counts?.tickets ?? 0}`,
      `回收站 ${data.counts?.deleted ?? 0}`,
      `FTS ${data.fts?.exists ? '已启用' : '未启用'}`,
    ].join(' &nbsp; ');
  }

  window.TicketHealth = { load, render };
})();
