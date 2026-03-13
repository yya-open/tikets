(function () {
  const config = window.TicketConfig || {};
  const limits = (config.validation && config.validation.maxLengths) || {};
  const requiredFields = (config.validation && config.validation.requiredFields) || ["date", "issue", "type"];
  const allowFutureDate = !!(config.validation && config.validation.allowFutureDate);
  const fieldNames = {
    date: "日期",
    issue: "问题",
    department: "部门",
    name: "姓名",
    solution: "处理方法",
    remarks: "备注",
    type: "类型"
  };

  function todayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function sanitizeText(value) {
    return String(value == null ? "" : value).replace(/　/g, " ").trim();
  }

  function sanitizeTicketPayload(payload) {
    const source = payload || {};
    return {
      date: sanitizeText(source.date),
      issue: sanitizeText(source.issue),
      department: sanitizeText(source.department),
      name: sanitizeText(source.name),
      solution: sanitizeText(source.solution),
      remarks: sanitizeText(source.remarks),
      type: sanitizeText(source.type)
    };
  }

  function validateTicketForm(payload) {
    const data = sanitizeTicketPayload(payload);
    const errors = [];
    const fieldErrors = {};

    requiredFields.forEach((field) => {
      if (!data[field]) fieldErrors[field] = `${fieldNames[field] || field}不能为空`;
    });

    if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      fieldErrors.date = "日期格式必须为 YYYY-MM-DD";
    } else if (data.date && !allowFutureDate && data.date > todayISO()) {
      fieldErrors.date = "日期不能晚于当天";
    }

    Object.entries(limits).forEach(([field, max]) => {
      if (String(data[field] || "").length > Number(max || 0)) {
        fieldErrors[field] = `${fieldNames[field] || field}不能超过 ${max} 个字符`;
      }
    });

    Object.values(fieldErrors).forEach((msg) => errors.push(msg));
    return { ok: errors.length === 0, errors, fieldErrors, payload: data };
  }

  function render(errors) {
    if (!Array.isArray(errors) || errors.length === 0) return "";
    return errors.map((item) => `- ${item}`).join("\n");
  }

  function errorEl(field) { return document.getElementById(`${field}Error`); }

  function setFieldError(field, message) {
    const input = document.getElementById(field);
    const el = errorEl(field);
    if (input) input.classList.toggle('is-invalid', !!message);
    if (el) el.textContent = message || '';
  }

  function clearValidationErrors() {
    Object.keys(fieldNames).forEach((field) => setFieldError(field, ''));
  }

  function applyValidationErrors(fieldErrors) {
    clearValidationErrors();
    const keys = Object.keys(fieldErrors || {});
    keys.forEach((field) => setFieldError(field, fieldErrors[field]));
    if (keys.length > 0) {
      const first = document.getElementById(keys[0]);
      if (first && typeof first.focus === 'function') first.focus();
    }
  }

  function validateSingleField(field) {
    const input = document.getElementById(field);
    if (!input) return true;
    const checked = validateTicketForm({ [field]: input.value, date: field === 'date' ? input.value : document.getElementById('date')?.value, issue: field === 'issue' ? input.value : document.getElementById('issue')?.value, type: field === 'type' ? input.value : document.getElementById('type')?.value });
    setFieldError(field, checked.fieldErrors[field] || '');
    return !checked.fieldErrors[field];
  }

  function applyFieldConstraints() {
    Object.entries(limits).forEach(([field, max]) => {
      const input = document.getElementById(field);
      if (input && max) input.maxLength = Number(max);
    });
    const date = document.getElementById('date');
    if (date && !allowFutureDate) date.max = todayISO();
  }

  function bindLiveValidation() {
    Object.keys(fieldNames).forEach((field) => {
      const input = document.getElementById(field);
      if (!input || input.dataset.validationBound === '1') return;
      input.dataset.validationBound = '1';
      input.addEventListener('blur', () => validateSingleField(field));
      input.addEventListener('input', () => {
        if (input.classList.contains('is-invalid')) validateSingleField(field);
      });
    });
  }

  function initFormValidationUI() {
    applyFieldConstraints();
    bindLiveValidation();
    clearValidationErrors();
  }

  window.TicketValidation = {
    validateTicketForm,
    sanitizeTicketPayload,
    render,
    clearValidationErrors,
    applyValidationErrors,
    initFormValidationUI
  };
})();
