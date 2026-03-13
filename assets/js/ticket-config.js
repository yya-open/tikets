(function () {
  const config = {
    storageKeys: {
      viewMode: "ticket_view_mode",
      foldState: "ticket_fold_state_v1"
    },
    defaults: {
      pageSize: 100,
      ticketType: "日常故障",
      modalDate: "today"
    },
    validation: {
      maxLengths: {
        issue: 200,
        department: 80,
        name: 80,
        solution: 4000,
        remarks: 4000
      },
      requiredFields: ["date", "issue", "type"],
      allowFutureDate: false
    },
    foldDefaults: {
      "settings-main": false,
      "settings-edit-key": false,
      "settings-one-click": false,
      "health-main": false,
      "query-export-main": false,
      "filters-advanced": false,
      "export-backup-actions": false,
      "tickets-main": true,
      "stats-main": false
    }
  };

  window.TicketConfig = Object.freeze(config);
})();
