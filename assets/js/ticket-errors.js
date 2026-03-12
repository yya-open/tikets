(function () {
  function map(payloadOrError, fallback) {
    const payload = payloadOrError && payloadOrError.data ? payloadOrError.data : payloadOrError;
    const code = String(payload?.code || payload?.error || payloadOrError?.code || '').trim();
    if (code === 'invalid_edit_key') return '写入口令错误，请重新输入。';
    if (code === 'missing_edit_key') return '请先设置写入口令后再执行写操作。';
    if (code === 'validation_error') {
      const fields = Array.isArray(payload?.fields) ? payload.fields : [];
      if (!fields.length) return '表单校验失败，请检查输入。';
      return fields.map((item) => `- ${item.field || 'field'}：${item.message || '格式错误'}`).join('\n');
    }
    if (code === 'conflict') return '数据已被别人修改，请先加载最新版本后再保存。';
    if (code === 'not_found') return '记录不存在，可能已被删除。';
    if (code === 'bad_request') return '请求参数错误，请检查后重试。';
    if (code === 'server_misconfigured') return '服务端未配置 EDIT_KEY。';
    if (payloadOrError?.status === 500) return '服务端异常，请稍后再试。';
    return fallback || '操作失败，请稍后重试。';
  }

  function isAuthError(err) {
    const code = String(err?.code || err?.data?.code || err?.data?.error || '');
    return code === 'invalid_edit_key' || code === 'missing_edit_key' || err?.status === 401 || err?.status === 403;
  }

  function toast(err, fallback) {
    const msg = map(err, fallback);
    if (typeof window.showToast === 'function') window.showToast(msg, isAuthError(err) ? 'warning' : 'error');
    return msg;
  }

  window.TicketErrors = { map, toast, isAuthError };
})();
