(function () {
  function val(id) { return String(document.getElementById(id)?.value || '').trim(); }
  function readFormPayload() { return { date: String(document.getElementById('date')?.value || ''), issue: val('issue'), department: val('department'), name: val('name'), solution: val('solution'), remarks: val('remarks'), type: String(document.getElementById('type')?.value || '日常故障') }; }
  function fillFormFromRecord(record) { if (!record) return; document.getElementById('date').value = record.date || ''; document.getElementById('issue').value = record.issue || ''; document.getElementById('department').value = record.department || ''; document.getElementById('name').value = record.name || ''; document.getElementById('solution').value = record.solution || ''; document.getElementById('remarks').value = record.remarks || ''; document.getElementById('type').value = record.type || '日常故障'; }
  function resetForm() { document.getElementById('ticketForm')?.reset(); }
  window.TicketEditor = { readFormPayload, fillFormFromRecord, resetForm };
})();
