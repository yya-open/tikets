(function () {
  const config = {
    storageKeys: {
      viewMode: "ticket_view_mode",
      foldState: "ticket_fold_state_v1",
      quickFill: "ticket_quick_fill_v1"
    },
    defaults: {
      pageSize: 100,
      ticketType: "日常故障",
      modalDate: "today"
    },
    quickFill: {
      issueTemplates: [
        "电脑无法开机",
        "系统登录异常",
        "打印机无法打印",
        "VPN 无法连接",
        "会议设备异常",
        "Office 软件报错"
      ],
      solutionTemplates: [
        "远程协助排查并处理，问题已恢复。",
        "重启设备/服务后恢复正常。",
        "检查账号权限并重新配置后恢复。",
        "更新客户端或驱动后恢复。",
        "现场排查并完成测试，用户确认正常。"
      ],
      recentLimit: 8
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
