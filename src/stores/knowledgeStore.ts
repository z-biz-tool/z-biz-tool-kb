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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  timestamp: number;
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

const EMPTY_SNAPSHOT: ChatSnapshot = { messages: [], draft: "" };

export function sanitizeChat(state: unknown): ChatSnapshot {
  const s = (state ?? {}) as Partial<ChatSnapshot>;
  return {
    messages: Array.isArray(s.messages)
      ? s.messages.filter(isChatMessage).slice(-MAX_PERSISTED_MESSAGES)
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
  uploadDocument: (filePath: string, fileName: string) => Promise<void>;
  deleteDocument: (docId: string) => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  retryLastQuestion: () => Promise<void>;
  loadLlmConfig: () => Promise<void>;
  setLlmConfig: (baseUrl: string, apiKey: string, model: string) => Promise<void>;
  setShowSettings: (show: boolean) => void;
  setDraft: (text: string) => void;
  clearMessages: () => void;
}

const hydrated = readSnapshot();

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
      documents: [],
      loadingDocs: false,
      docsError: null,

      messages: hydrated.messages,
      draft: hydrated.draft,
      asking: false,
      askError: null,
      lastQuestion: null,

      llmConfig: null,
      llmConfigError: null,
      showSettings: false,

      loadDocuments: async () => {
        set({ loadingDocs: true });
        try {
          const docs = await invoke<DocumentInfo[]>("list_documents");
          set({ documents: docs, loadingDocs: false, docsError: null });
        } catch (e) {
          set({ loadingDocs: false, docsError: toMessage(e) });
        }
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
