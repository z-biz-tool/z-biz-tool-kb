// 文档列表/详情用到的纯展示逻辑。
//
// 抽出来是为了可测：这些函数决定「用户看到的数字与状态」，
// 而编造数值（NaN 日期、未知状态当就绪）比报错更难被发现。

export type StatusClass = "ready" | "processing" | "failed" | "unknown";

export interface StatusInfo {
  label: string;
  className: StatusClass;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  // `new Date("乱码")` 不抛异常，只得到一个 Invalid Date；
  // 原先用 try/catch 兜底，结果是界面上出现 "NaN/NaN NaN:NaN"。
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${d
    .getHours()
    .toString()
    .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function getStatusInfo(status: string): StatusInfo {
  switch (status?.trim().toLowerCase()) {
    case "ready":
    case "ok":
    case "done":
      return { label: "就绪", className: "ready" };
    case "processing":
    case "pending":
    case "loading":
      return { label: "处理中", className: "processing" };
    case "failed":
    case "error":
      return { label: "失败", className: "failed" };
    default:
      // 认不出的状态不能默认说「就绪」—— 那是替后端编造状态。
      return { label: "未知", className: "unknown" };
  }
}

export function clearChatConfirmText(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return n > 0
    ? `将删除 ${n} 条对话消息，清空后无法恢复。`
    : "将清空当前对话，无法恢复。";
}

export function detailTruncationNote(shown: number, total: number): string | null {
  if (!Number.isFinite(shown) || !Number.isFinite(total)) return null;
  if (total <= shown) return null;
  return `仅展示前 ${shown} 个切片，共 ${total} 个。`;
}
