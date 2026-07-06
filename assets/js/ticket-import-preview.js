(function () {
  const SECTIONS = [
    { key: "inserts", title: "新增示例", empty: "没有新增记录", tone: "success" },
    { key: "updates", title: "更新示例", empty: "没有更新记录", tone: "primary" },
    { key: "skips", title: "跳过示例", empty: "没有跳过记录", tone: "warning" },
    { key: "invalid", title: "无效示例", empty: "没有无效记录", tone: "danger" },
  ];

  function count(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function lines(items, emptyText) {
    if (!Array.isArray(items) || items.length === 0) return emptyText;
    return items.map((item) => {
      const idPart = item.id === null || item.id === undefined ? "新记录" : `#${item.id}`;
      return `• ${idPart} ${item.date || ""} ${item.issue || ""} —— ${item.reason || ""}`.trim();
    }).join("\n");
  }

  function format(preview) {
    const t = preview?.totals || {};
    const ex = preview?.examples || {};
    return [
      `新增：${t.inserts || 0} 条`,
      `更新：${t.updates || 0} 条`,
      `跳过：${t.skips || 0} 条`,
      `无效：${t.invalid || 0} 条`,
      `输入：${t.incoming || 0} 条（active ${t.active || 0} / trash ${t.trash || 0}）`,
      "",
      "新增示例：",
      lines(ex.inserts, "无"),
      "",
      "更新示例：",
      lines(ex.updates, "无"),
      "",
      "跳过示例：",
      lines(ex.skips, "无"),
      "",
      "无效示例：",
      lines(ex.invalid, "无"),
    ].join("\n");
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendStat(root, label, value, tone) {
    const card = el("div", `import-preview-stat ${tone || ""}`.trim());
    card.appendChild(el("div", "import-preview-stat-label", label));
    card.appendChild(el("div", "import-preview-stat-value", `${count(value)} 条`));
    root.appendChild(card);
  }

  function itemTitle(item) {
    const idPart = item.id === null || item.id === undefined ? "新记录" : `#${item.id}`;
    return [idPart, item.date || "", item.issue || ""].filter(Boolean).join(" ");
  }

  function appendExampleItem(list, item) {
    const row = el("li", "import-preview-item");
    row.appendChild(el("div", "import-preview-item-title", itemTitle(item)));
    row.appendChild(el("div", "import-preview-item-reason", item.reason || "未提供原因"));
    list.appendChild(row);
  }

  function appendSection(root, section, totals, examples) {
    const total = count(totals[section.key]);
    const items = Array.isArray(examples[section.key]) ? examples[section.key] : [];
    const block = el("section", "import-preview-section");
    const header = el("div", "import-preview-section-head");
    header.appendChild(el("div", "import-preview-section-title", section.title));
    header.appendChild(el("div", `import-preview-count ${section.tone}`, `${total} 条`));
    block.appendChild(header);

    if (items.length) {
      const list = el("ul", "import-preview-list");
      items.forEach((item) => appendExampleItem(list, item));
      block.appendChild(list);
    } else {
      block.appendChild(el("div", "import-preview-empty", section.empty));
    }

    root.appendChild(block);
  }

  function render(preview) {
    const t = preview?.totals || {};
    const ex = preview?.examples || {};
    const root = el("div", "import-preview");
    const stats = el("div", "import-preview-stats");
    appendStat(stats, "新增", t.inserts, "success");
    appendStat(stats, "更新", t.updates, "primary");
    appendStat(stats, "跳过", t.skips, "warning");
    appendStat(stats, "无效", t.invalid, "danger");
    appendStat(stats, "输入", t.incoming, "");
    root.appendChild(stats);

    const split = el(
      "div",
      "import-preview-split",
      `来源：正常工单 ${count(t.active)} 条 / 回收站 ${count(t.trash)} 条`
    );
    root.appendChild(split);

    const sections = el("div", "import-preview-sections");
    SECTIONS.forEach((section) => appendSection(sections, section, t, ex));
    root.appendChild(sections);
    return root;
  }

  window.TicketImportPreview = { format, render };
})();
