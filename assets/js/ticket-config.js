(function () {
  const config = {
    storageKeys: {
      viewMode: "ticket_view_mode",
      foldState: "ticket_fold_state_v1"
    },
    defaults: {
      pageSize: 100,
      ticketType: "日常故障",
      ticketTypes: [
        "日常故障",
        "office365套装故障",
        "OA等业务平台故障",
        "电脑维修报修",
        "电脑重置安装",
        "密码问题",
        "打印机问题",
        "VPN/网络问题",
        "会议问题",
        "用户咨询"
      ],
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
