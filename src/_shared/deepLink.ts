/**
 * zbiz:// 深链接的 **kb 语义层**。
 *
 * ## 分工
 *
 * | 层 | 在哪 | 管什么 |
 * |----|----|--------|
 * | 协议 | `z-biz-tool-shared/protocol/deeplink` | 字节级编解码（金标 = Rust `cap-hub`） |
 * | 机制 | `z-biz-tool-shared/protocol/deeplinkReceiver` | 冷启动补取、事件监听、不静默吞掉 |
 * | **语义** | **本文件** | **收到深链后 kb 该做什么** |
 *
 * ## kb 支持的动作
 *
 * | action | 含义 | 参数 |
 * |--------|------|------|
 * | `open` | 打开某篇文档的详情抽屉 | `doc`（文档 id）或 `name`（文档名，兜底） |
 * | `ask` | 往提问框里填一个问题 | `q`（问题文本） |
 *
 * ## 为什么只有这两个
 *
 * kb 的界面只有两块可交互面：**文档库**（左栏）和**问答**（右栏）。
 * 深链要能定位的东西必须落在这两者之一，否则就是一条落不了地的空深链。
 *
 * 文档 id 是后端 `list_documents` 返回的稳定 id（入库时生成），所以 `doc` 可以精确命中。
 * 但发深链的人（box / note）拿到的往往只是**文件名** —— 那是用户看得见的东西，
 * 所以 `name` 是必须的兜底。
 *
 * 提问参数用 `q` 而不是 `question`：短、不会被 `checkToken` 挡（参数名只允许字母数字 - _），
 * 且与「query」语义对得上。
 */

import type { Handoff } from "z-biz-tool-shared/protocol";

/**
 * Rust 侧 `cap_hub::Handoff` 的镜像。
 *
 * 名字叫 `HandoffItem` 是为了在本仓内部读起来更顺（本仓此前一直用这个名字），
 * 实质就是共享层的 `Handoff`。
 */
export type { Handoff as HandoffItem } from "z-biz-tool-shared/protocol";

/**
 * kb 的深链结果。
 *
 * `docId` / `docName` 非 null 表示要打开某篇文档；
 * `question` 非 null 表示要往提问框里填问题；
 * `problem` 非 null 表示接不住 —— 前端必须给可见提示（不静默吞掉）。
 */
export interface KbDeepLinkOutcome {
  /** 要打开的文档 id（深链直接给的）。 */
  docId: string | null;
  /** 要打开的文档名（深链给的兜底标识）。 */
  docName: string | null;
  /** 要填进提问框的问题。 */
  question: string | null;
  /** 发送方（from），仅用于提示与日志 */
  from: string | null;
  /** 无法适配时的原因 */
  problem: string | null;
}

/**
 * 把一条深链翻译成 kb 内的动作。
 *
 * 纯函数 —— 不碰 store、不碰 Tauri，所以可以直接单测。
 *
 * @param item 深链
 */
export function resolveKbDeepLink(item: Handoff): KbDeepLinkOutcome {
  const outcome: KbDeepLinkOutcome = {
    docId: null,
    docName: null,
    question: null,
    from: item.params.from ?? null,
    problem: null,
  };

  const action = item.action.trim() || "open";

  // 动作先校验：动作不认识的话，后面的参数再合法也没意义，
  // 而且不能让已解析的字段残留在 outcome 里（接不住就是接不住，别半落地）。
  if (action !== "open" && action !== "ask") {
    outcome.problem = `不认识的动作 ${action}`;
    return outcome;
  }

  const rawDoc = item.params.doc?.trim() ?? "";
  const rawName = item.params.name?.trim() ?? "";
  const rawQ = item.params.q?.trim() ?? "";

  if (action === "ask") {
    if (!rawQ) {
      outcome.problem = "深链里没有 q（问题内容）参数";
      return outcome;
    }
    outcome.question = rawQ;
    return outcome;
  }

  // open：给了 id 就用 id，同时保留 name（找不到 id 时用来给用户一句人话）。
  if (rawDoc) {
    outcome.docId = rawDoc;
    if (rawName) outcome.docName = rawName;
    return outcome;
  }
  if (rawName) {
    outcome.docName = rawName;
    return outcome;
  }

  outcome.problem = "深链里没有 doc（文档 id）或 name（文档名）参数";
  return outcome;
}
