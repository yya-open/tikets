(function () {
  function validateTicketForm(payload) {
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ""))) {
      errors.push("日期必须填写且格式为 YYYY-MM-DD");
    }
    if (!String(payload.issue || "").trim()) {
      errors.push("问题不能为空");
    }
    if (String(payload.issue || "").trim().length > 200) {
      errors.push("问题不能超过 200 个字符");
    }
    if (String(payload.department || "").trim().length > 80) {
      errors.push("部门不能超过 80 个字符");
    }
    if (String(payload.name || "").trim().length > 80) {
      errors.push("姓名不能超过 80 个字符");
    }
    if (String(payload.solution || "").trim().length > 4000) {
      errors.push("处理方法不能超过 4000 个字符");
    }
    if (String(payload.remarks || "").trim().length > 4000) {
      errors.push("备注不能超过 4000 个字符");
    }
    return { ok: errors.length === 0, errors };
  }

  function render(errors) {
    if (!Array.isArray(errors) || errors.length === 0) return "";
    return errors.map((item) => `- ${item}`).join("\n");
  }

  window.TicketValidation = { validateTicketForm, render };
})();
