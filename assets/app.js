// Chart 插件：在饼图外显示标签（类型/数量/占比）
// 依赖 chartjs-plugin-datalabels（已在 <head> 引入）
if (typeof Chart !== "undefined" && typeof ChartDataLabels !== "undefined") {
  try { Chart.register(ChartDataLabels); } catch (e) {}
}

// 注意：
// 历史版本曾在此文件重复定义 loadFromServer / reloadAndRender，
// 由于 defer 脚本按 DOM 顺序执行，会静默覆盖 ticket-query-controller.js
// 中的编排版实现，导致写入或会话切换后未过滤地拉取默认页、
// 分页与月份 meta 不刷新。已删除该重复定义，唯一实现由
// assets/js/ticket-query-controller.js 提供。
