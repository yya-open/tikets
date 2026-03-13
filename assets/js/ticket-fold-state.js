(function () {
  const STORAGE_KEY = (window.TicketConfig && window.TicketConfig.storageKeys && window.TicketConfig.storageKeys.foldState) || "ticket_fold_state_v1";
  const defaults = (window.TicketConfig && window.TicketConfig.foldDefaults) || {};

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state || {})); } catch (e) {}
  }

  function applyInitialState(details, state) {
    const key = details.dataset.foldKey;
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      details.open = !!state[key];
      return;
    }
    if (Object.prototype.hasOwnProperty.call(defaults, key)) {
      details.open = !!defaults[key];
    }
  }

  function bindPersistence(details, state) {
    const key = details.dataset.foldKey;
    if (!key) return;
    details.addEventListener('toggle', function () {
      state[key] = !!details.open;
      writeState(state);
    });
  }

  function init() {
    const state = readState();
    document.querySelectorAll('details[data-fold-key]').forEach(function (details) {
      applyInitialState(details, state);
      bindPersistence(details, state);
    });
  }

  window.TicketFoldState = { init };
})();
