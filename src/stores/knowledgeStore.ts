import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// ============================================================
// 类型定义
// ============================================================

export interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  doc_type: string;
  chunk_count: number;
  created_at: string;
  status: string;
}

export interface Citation {
  doc_id: string;
  doc_name: string;
  chunk_index: number;
  text: string;
  score: number;
}

export interface DocumentChunk {
  doc_id: string;
  doc_name: string;
  index: number;
  text: string;
}

export interface DocumentDetail {
  meta: DocumentInfo;
  total_chunks: number;
  chunks: DocumentChunk[];
  truncated: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  // 旧版本快照可能没有时间戳；消息本身仍然可显示，不必因此丢掉
  timestamp?: number;
}

export interface LlmConfig {
  base_url: string;
  api_key: string;
  model: string;
}

// Tauri 的 invoke 抛出的是 Rust 侧的 String 错误，不是 Error 实例
export function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message || "未知错误";
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    // `{ message: undefined }` 里 message 键存在，`"message" in e` 为真，
    // String(undefined) === "undefined"。把它当错误文案显示出去，
    // 正是这个函数存在的意义所要防的那件事 —— 用户看到的是一句废话。
    const m = String((e as { message: unknown }).message);
    // 注意这里**直接返回**而不是落穿到下面的 String(e)：
    // 落穿会得到 "[object Object]"，比 "undefined" 还难懂。
    return m && m !== "undefined" && m !== "null" ? m : "未知错误";
  }
  const s = String(e);
  return s === "undefined" || s === "null" || s === "" ? "未知错误" : s;
}

const CHAT_STORAGE_KEY = "z-biz-tool-kb-chat";
const CHAT_STORAGE_VERSION = 1;
const MAX_MESSAGES = 300;
const MAX_PERSISTED_MESSAGES = 120;

interface ChatSnapshot {
  messages: ChatMessage[];
  draft: string;
}

// 导出只为可测：这是 localStorage 脏数据的入口防线，形状错了就该被滤掉，
// 而它此前是模块私有的 —— 整条防线一次都没被执行过。
export function isChatMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const x = m as Record<string, unknown>;
  return (x.role === "user" || x.role === "assistant") && typeof x.content === "string";
}

// 引用来自 localStorage 里的历史快照，同样可能是脏的：
// `citation.text.length` 在渲染时会被直接读，`text` 不是字符串就会白屏。
export function isCitation(c: unknown): c is Citation {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  return (
    typeof x.doc_id === "string" &&
    typeof x.doc_name === "string" &&
    typeof x.text === "string" &&
    typeof x.chunk_index === "number" &&
    Number.isFinite(x.chunk_index) &&
    typeof x.score === "number" &&
    Number.isFinite(x.score)
  );
}

function sanitizeMessage(m: ChatMessage): ChatMessage {
  const out: ChatMessage = { role: m.role, content: m.content };
  if (typeof m.timestamp === "number" && Number.isFinite(m.timestamp)) {
    out.timestamp = m.timestamp;
  }
  if (Array.isArray(m.citations)) {
    const valid = m.citations.filter(isCitation);
    if (valid.length > 0) out.citations = valid;
  }
  return out;
}

const EMPTY_SNAPSHOT: ChatSnapshot = { messages: [], draft: "" };

export function sanitizeChat(state: unknown): ChatSnapshot {
  const s = (state ?? {}) as Partial<ChatSnapshot>;
  return {
    messages: Array.isArray(s.messages)
      ? s.messages
          .filter(isChatMessage)
          .map(sanitizeMessage)
          .slice(-MAX_PERSISTED_MESSAGES)
      : [],
    draft: typeof s.draft === "string" ? s.draft : "",
  };
}

// 版本号不符就整份丢弃：形状变了宁可丢历史，也不能让脏数据把应用卡在白屏
function readSnapshot(): ChatSnapshot {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return EMPTY_SNAPSHOT;
    const parsed = JSON.parse(raw) as { version?: number } | null;
    if (!parsed || parsed.version !== CHAT_STORAGE_VERSION) return EMPTY_SNAPSHOT;
    return sanitizeChat(parsed);
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

// ============================================================
// Store
// ============================================================

interface KnowledgeState {
  // 文档列表
  documents: DocumentInfo[];
  loadingDocs: boolean;
  /**
   * 列表**至少加载过一次**（成功或失败都算）。
   *
   * 只看 `loadingDocs === false` 分不出「还没开始加载」和「加载完了但库里没这篇」——
   * 两者都是空数组 + 不转圈。深链要按 name 兜底找文档，分不清就只能一直挂着等，
   * 用户看到的是「点了没反应」。有了这个标志，找不到时能给出「库里没有这篇」的提示。
   */
  docsLoaded: boolean;
  docsError: string | null;

  // 对话历史
  messages: ChatMessage[];
  draft: string;
  asking: boolean;
  askError: string | null;
  lastQuestion: string | null;

  // LLM配置
  llmConfig: LlmConfig | null;
  llmConfigError: string | null;
  showSettings: boolean;

  // 操作
  loadDocuments: () => Promise<void>;
  getDocumentDetail: (docId: string) => Promise<DocumentDetail>;
  uploadDocument: (filePath: string, fileName: string) => Promise<void>;
  deleteDocument: (docId: string) => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  retryLastQuestion: () => Promise<void>;
  loadLlmConfig: () => Promise<void>;
  setLlmConfig: (baseUrl: string, apiKey: string, model: string) => Promise<void>;
  setShowSettings: (show: boolean) => void;
  setDraft: (text: string) => void;
  clearMessages: () => void;

  /**
   * 待打开的文档。
   *
   * 详情抽屉原本是 DocumentList 的局部 state，深链接（在 App 层）够不着它。
   * 所以把「要打开哪篇」提到 store 里：深链接填这个字段，
   * DocumentList 看到它变化且文档列表已就绪时就打开抽屉。
   *
   * 文档列表是异步加载的，所以这个字段要能在「列表还没到」时先挂着 ——
   * 文档列表到位后 DocumentList 会重新匹配。
   *
   * id 与 name **两个都存**：发深链的人（box / note）往往只拿得到文件名，
   * 只存 id 的话，`zbiz://kb/open?name=xxx.pdf` 会被静默吞掉 —— 用户点了没反应。
   * 匹配时 id 优先，匹配不到再按 name 兜底。
   */
  pendingDoc: { id: string | null; name: string | null } | null;
  setPendingDoc: (doc: { id: string | null; name: string | null } | null) => void;
}

const hydrated = readSnapshot();

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
      documents: [],
      loadingDocs: false,
      docsLoaded: false,
      docsError: null,

      messages: hydrated.messages,
      draft: hydrated.draft,
      asking: false,
      askError: null,
      lastQuestion: null,

      llmConfig: null,
      llmConfigError: null,
      showSettings: false,

      pendingDoc: null,
      setPendingDoc: (pendingDoc) => set({ pendingDoc }),

      loadDocuments: async () => {
        set({ loadingDocs: true });
        try {
          const docs = await invoke<DocumentInfo[]>("list_documents");
          set({ documents: docs, loadingDocs: false, docsError: null });
        } catch (e) {
          set({ loadingDocs: false, docsError: toMessage(e) });
        }
        // 成功失败都置位：深链落地不能因为一次加载失败就永远挂着等
        set({ docsLoaded: true });
      },

      getDocumentDetail: async (docId: string) => {
        return invoke<DocumentDetail>("get_document_detail", { docId });
      },

      uploadDocument: async (filePath: string, fileName: string) => {
        await invoke("upload_document", { filePath, fileName });
        await get().loadDocuments();
      },

      deleteDocument: async (docId: string) => {
        await invoke("delete_document", { docId });
        await get().loadDocuments();
      },

      askQuestion: async (question: string) => {
        const userMessage: ChatMessage = {
          role: "user",
          content: question,
          timestamp: Date.now(),
        };
        set((state) => ({
          messages: [...state.messages, userMessage].slice(-MAX_MESSAGES),
          asking: true,
          askError: null,
          lastQuestion: question,
        }));
        await get().retryLastQuestion();
      },

      retryLastQuestion: async () => {
        const question = get().lastQuestion;
        if (!question) return;
        set({ asking: true, askError: null });
        try {
          const result = await invoke<{ answer: string; citations: Citation[] }>("ask_question", {
            question,
          });

          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: result.answer,
            citations: result.citations,
            timestamp: Date.now(),
          };
          set((state) => ({
            messages: [...state.messages, assistantMessage].slice(-MAX_MESSAGES),
            asking: false,
            askError: null,
          }));
        } catch (e) {
          set({ asking: false, askError: toMessage(e) });
        }
      },

      loadLlmConfig: async () => {
        try {
          const config = await invoke<LlmConfig>("get_llm_config");
          set({ llmConfig: config, llmConfigError: null });
        } catch (e) {
          set({ llmConfigError: toMessage(e) });
        }
      },

      setLlmConfig: async (baseUrl: string, apiKey: string, model: string) => {
        await invoke("set_llm_config", { baseUrl, apiKey, model });
        await get().loadLlmConfig();
        set({ showSettings: false });
      },

      setShowSettings: (show: boolean) => set({ showSettings: show }),

      setDraft: (text: string) => set({ draft: text }),

      clearMessages: () => set({ messages: [], askError: null, lastQuestion: null }),
}));

let flushTimer: ReturnType<typeof setTimeout> | null = null;

// 每条消息、每次按键都同步写盘会卡输入，故去抖 300ms 合并落盘
useKnowledgeStore.subscribe((s) => {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        CHAT_STORAGE_KEY,
        JSON.stringify({
          version: CHAT_STORAGE_VERSION,
          messages: s.messages.slice(-MAX_PERSISTED_MESSAGES),
          draft: s.draft,
        })
      );
    } catch {
      /* 配额满了也不影响干活 */
    }
  }, 300);
});
