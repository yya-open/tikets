    function updateStatsAndChartsFromStats(stats) {
      const totalAll = Number(stats?.total_all ?? metaTotalAll ?? 0) || 0;
      const totalFiltered = Number(stats?.total_filtered ?? serverTotal ?? 0) || 0;

      const countsByType = (stats && stats.type_counts) ? stats.type_counts : {};
      const countsByMonth = (stats && stats.month_counts) ? stats.month_counts : {};

      // ===== 概览卡片 =====
      const typeKinds = Object.keys(countsByType).length;
      const topType = Object.entries(countsByType).sort((a,b) => b[1]-a[1])[0]?.[0] || "-";
      const topTypeCount = Object.entries(countsByType).sort((a,b) => b[1]-a[1])[0]?.[1] || 0;

      const cardsEl = document.getElementById("statsCards");
      if (cardsEl) {
        cardsEl.innerHTML = `
          <div class="stat">
            <div class="label">当前视图工单数</div>
            <div class="value">${totalFiltered}</div>
            <div class="sub">已应用筛选 + 年/月视图</div>
          </div>
          <div class="stat">
            <div class="label">全部记录数</div>
            <div class="value">${totalAll}</div>
            <div class="sub">当前模式总量（${viewMode === "trash" ? "回收站" : "工单"}）</div>
          </div>
          <div class="stat">
            <div class="label">类型数量</div>
            <div class="value">${typeKinds}</div>
            <div class="sub">Top：${escapeHtml(topType)}（${topTypeCount}）</div>
          </div>
        `;
      }

      // 兼容：老版本页面的 #stats（如果存在就也填一下，避免空白）
      const statsEl = document.getElementById("stats");
      if (statsEl) {
        statsEl.innerHTML = `<div class="muted">全部记录：${totalAll} 条；当前视图：${totalFiltered} 条。</div>`;
      }

      // ===== 颜色生成 =====
      function genColors(n) {
        const out = [];
        const base = 210; // 蓝系起点
        for (let i = 0; i < n; i++) {
          const hue = (base + i * (360 / Math.max(1, n))) % 360;
          out.push(`hsl(${hue} 75% 55%)`);
        }
        return out;
      }

      // ===== 自定义图例 =====
      function renderLegend(labels, values, colors) {
        const legend = document.getElementById("typeLegend");
        if (!legend) return;
        if (!labels.length) {
          legend.innerHTML = `<div class="muted">暂无数据</div>`;
          return;
        }
        const sum = values.reduce((a,b) => a + b, 0) || 1;
        legend.innerHTML = labels.map((name, idx) => {
          const v = values[idx] || 0;
          const pct = Math.round((v / sum) * 1000) / 10; // 1 位小数
          return `
            <div class="legend-item" title="${escapeHtml(name)}">
              <span class="legend-swatch" style="background:${colors[idx]};"></span>
              <span class="legend-name">${escapeHtml(name)}</span>
              <span class="legend-meta">
                <span class="legend-count">${v}</span>
                <span class="legend-pct">${pct}%</span>
              </span>
            </div>
          `;
        }).join("");
      }

      // ===== 饼图（类型分布）=====
      const pieLabels = Object.keys(countsByType);
      const pieData = pieLabels.map(l => Number(countsByType[l]) || 0);
      const pieColors = genColors(pieLabels.length);

      if (typePieChart) typePieChart.destroy();
      const pieCanvas = document.getElementById("typePieChart");
      if (pieCanvas) {
        const pieCtx = pieCanvas.getContext("2d");
        typePieChart = new Chart(pieCtx, {
          type: "pie",
          data: {
            labels: pieLabels,
            datasets: [{
              data: pieData,
              backgroundColor: pieColors,
            radius: "80%",
              borderColor: "#ffffff",
              borderWidth: 2,
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 36, right: 44, bottom: 44, left: 44 } },
            plugins: {
              legend: { display: false },
              
// 标签太多时外侧文字会重叠：改为“仅显示较大扇区的百分比”，其余信息放到右侧图例/悬浮提示中
datalabels: {
  color: "#fff",
  font: { size: 12, weight: "700" },
  textAlign: "center",
  anchor: "center",
  align: "center",
  offset: 0,
  clamp: true,
  clip: true,
  display: (ctx) => {
    const arr = ctx.dataset?.data || [];
    const value = Number(arr[ctx.dataIndex] ?? 0);
    const sum = arr.reduce((a,b)=>a+Number(b||0),0) || 1;
    const pct = value / sum;
    // 显示规则：>= 8% 的扇区一定显示；否则仅显示“前 5 大”的扇区，避免满屏文字
    let higher = 0;
    for (const v of arr) if (Number(v||0) > value) higher++;
    const isTop5 = higher < 5;
    return pct >= 0.08 || isTop5;
  },
  formatter: (value, ctx) => {
    const arr = ctx.dataset?.data || [];
    const sum = arr.reduce((a,b)=>a+Number(b||0),0) || 1;
    const pct = Math.round((Number(value||0)/sum)*1000)/10;
    return `${pct}%`;
  }
},
tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const v = ctx.parsed ?? 0;
                    const sum = pieData.reduce((a,b)=>a+b,0) || 1;
                    const pct = Math.round((v/sum)*1000)/10;
                    return `${ctx.label}: ${v}（${pct}%）`;
                  }
                }
              }
            }
          }
        });
      }
      renderLegend(pieLabels, pieData, pieColors);

      // ===== 柱状图（按月份数量）=====
      const monthKeys = Object.keys(countsByMonth).sort();
      const barLabels = monthKeys;
      const barData = monthKeys.map(k => Number(countsByMonth[k]) || 0);

      if (monthBarChart) monthBarChart.destroy();
      const barCanvas = document.getElementById("monthBarChart");
      if (barCanvas) {
        const barCtx = barCanvas.getContext("2d");
        monthBarChart = new Chart(barCtx, {
          type: "bar",
          data: {
            labels: barLabels,
            datasets: [{
              label: "工单数量",
              data: barData,
              borderWidth: 1,
              borderRadius: 6,
              maxBarThickness: 36
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: (items) => items?.[0]?.label || "",
                  label: (ctx) => `数量：${ctx.parsed.y ?? 0}`
                }
              }
            },
            scales: {
              x: { title: { display: true, text: "月份" }, grid: { display: false } },
              y: { title: { display: true, text: "工单数量" }, beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(0,0,0,0.06)" } }
            }
          }
        });
      }
    }


    
