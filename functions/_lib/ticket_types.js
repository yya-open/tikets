export const DEFAULT_TICKET_TYPES = [
  "日常故障",
  "office365套装故障",
  "OA等业务平台故障",
  "电脑维修报修",
  "电脑重置安装",
  "密码问题",
  "打印机问题",
  "VPN/网络问题",
  "会议问题",
  "用户咨询",
];

export function normalizeTypeName(raw) {
  return String(raw ?? "").replace(/\r\n/g, "\n").trim().slice(0, 80);
}

export function defaultTypeRows() {
  return DEFAULT_TICKET_TYPES.map((name, index) => ({
    id: null,
    name,
    sort_order: (index + 1) * 10,
    is_enabled: 1,
    ticket_count: 0,
    builtin: true,
  }));
}
