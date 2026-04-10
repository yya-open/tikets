(function () {
  function bindClick(id, handler, options = {}) {
    const el = document.getElementById(id);
    if (!el || typeof handler !== 'function') return;
    el.addEventListener('click', function (event) {
      if (options.stopPropagation) event.stopPropagation();
      handler(event);
    });
  }

  function bindChange(id, handler) {
    const el = document.getElementById(id);
    if (!el || typeof handler !== 'function') return;
    el.addEventListener('change', handler);
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindClick('btnOpenTicketModal', function () { window.openTicketModal && window.openTicketModal(true); });
    bindClick('btnOpenKeyModal', function () { window.openKeyModal && window.openKeyModal(); }, { stopPropagation: true });
    bindClick('btnTestEditKey', function () { window.testEditKey && window.testEditKey(); }, { stopPropagation: true });
    bindClick('btnOneClick', function () { window.runOneClickInit && window.runOneClickInit(); }, { stopPropagation: true });
    bindClick('btnOneClickDetails', function () { window.showOneClickDetails && window.showOneClickDetails(); }, { stopPropagation: true });

    bindClick('btnApplyFilters', function () { window.renderTable && window.renderTable(); });
    bindChange('yearSelect', function () { window.onYearChange && window.onYearChange(); });
    bindClick('btnClearFilters', function () { window.clearFilters && window.clearFilters(); });
    bindClick('trashToggleBtn', function () { window.toggleTrashView && window.toggleTrashView(); });

    bindClick('btnExportExcelCurrent', function () { window.exportExcelCurrent && window.exportExcelCurrent(); });
    bindClick('btnExportCurrentJson', function () { window.exportCurrentJson && window.exportCurrentJson(); });
    bindClick('btnExportSummaryExcel', function () { window.exportSummaryExcel && window.exportSummaryExcel(); });
    bindClick('btnExportExcelByMonth', function () { window.exportExcelByMonth && window.exportExcelByMonth(); });
    bindClick('btnBackupData', function () { window.backupData && window.backupData(); });
    bindClick('btnArchiveByMonthJSON', function () { window.archiveByMonthJSON && window.archiveByMonthJSON(); });
    bindClick('btnExportYearZip', function () { window.exportYearZip && window.exportYearZip(); });
    bindClick('btnManualBackup', function () { window.manualBackup && window.manualBackup(); });
    bindChange('backupFileInput', function (event) { window.loadBackup && window.loadBackup(event); });

    bindClick('ticketModalClose', function () { window.closeTicketModal && window.closeTicketModal(); });
    bindClick('btnResetForm', function () { window.resetForm && window.resetForm(true); });
    bindClick('btnCloseTicketModal', function () { window.closeTicketModal && window.closeTicketModal(); });
    const ticketForm = document.getElementById('ticketForm');
    if (ticketForm) {
      ticketForm.addEventListener('submit', function (event) {
        event.preventDefault();
        window.addOrUpdateRecord && window.addOrUpdateRecord();
      });
    }
    const ticketModal = document.getElementById('ticketModal');
    if (ticketModal) {
      ticketModal.addEventListener('click', function (event) {
        window.onTicketModalMaskClick && window.onTicketModalMaskClick(event);
      });
    }

    bindClick('ticketDetailModalClose', function () { window.closeTicketDetailModal && window.closeTicketDetailModal(); });
    const ticketDetailModal = document.getElementById('ticketDetailModal');
    if (ticketDetailModal) {
      ticketDetailModal.addEventListener('click', function (event) {
        window.onTicketDetailMaskClick && window.onTicketDetailMaskClick(event);
      });
    }

    bindClick('keyModalCloseTop', function () { window.closeKeyModal && window.closeKeyModal(); });
    bindClick('btnCloseKeyModal', function () { window.closeKeyModal && window.closeKeyModal(); });
    bindClick('btnClearEditKey', function () { window.clearEditKeyFromUI && window.clearEditKeyFromUI(); });
    bindClick('btnTestEditKeyModal', function () { window.testEditKey && window.testEditKey(); });
    bindClick('btnSaveEditKey', function () { window.saveEditKeyFromUI && window.saveEditKeyFromUI(); });
    bindChange('editKeyShow', function () { window.toggleEditKeyVisibility && window.toggleEditKeyVisibility(); });
    const keyModal = document.getElementById('keyModal');
    if (keyModal) {
      keyModal.addEventListener('click', function (event) {
        window.onKeyModalMaskClick && window.onKeyModalMaskClick(event);
      });
    }
  });
})();
