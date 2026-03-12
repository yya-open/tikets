(function () {
  async function fetchSummary(searchParams) {
    const sp = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || {});
    const res = await fetch(`/api/stats?${sp.toString()}`);
    if (!res.ok) throw new Error(`stats failed: ${res.status}`);
    return await res.json();
  }
  window.TicketStats = { fetchSummary };
})();
