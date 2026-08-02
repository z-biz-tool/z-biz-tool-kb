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

// ============================================================
// Store
// ============================================================

interface KnowledgeState {
  // 文档列表
  documents: DocumentInfo[];
  loadingDocs: boolean;

  // 对话历史
  messages: ChatMessage[];
  asking: boolean;
  askError: string | null;
  lastQuestion: string | null;

  // LLM配置
  llmConfig: LlmConfig | null;
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
  clearMessages: () => void;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  documents: [],
  loadingDocs: false,
  messages: [],
  asking: false,
  askError: null,
  lastQuestion: null,
  llmConfig: null,
  showSettings: false,

  loadDocuments: async () => {
    set({ loadingDocs: true });
    try {
      const docs = await invoke<DocumentInfo[]>("list_documents");
      set({ documents: docs, loadingDocs: false });
    } catch (e) {
      console.error("加载文档列表失败:", e);
      set({ loadingDocs: false });
    }
  },

  uploadDocument: async (filePath: string, fileName: string) => {
    try {
      await invoke("upload_document", {
        filePath: filePath,
        fileName: fileName,
      });
      await get().loadDocuments();
    } catch (e) {
      console.error("上传文档失败:", e);
      throw e;
    }
  },

  deleteDocument: async (docId: string) => {
    try {
      await invoke("delete_document", { docId: docId });
      await get().loadDocuments();
    } catch (e) {
      console.error("删除文档失败:", e);
      throw e;
    }
  },

  askQuestion: async (question: string) => {
    // 添加用户消息
    const userMessage: ChatMessage = {
      role: "user",
      content: question,
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, userMessage],
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
      const result = await invoke<{
        answer: string;
        citations: Citation[];
      }>("ask_question", { question });

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.answer,
        citations: result.citations,
        timestamp: Date.now(),
      };
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        asking: false,
        askError: null,
      }));
    } catch (e) {
      set({ asking: false, askError: String(e) });
    }
  },

  loadLlmConfig: async () => {
    try {
      const config = await invoke<LlmConfig>("get_llm_config");
      set({ llmConfig: config });
    } catch (e) {
      console.error("加载LLM配置失败:", e);
    }
  },

  setLlmConfig: async (baseUrl: string, apiKey: string, model: string) => {
    try {
      await invoke("set_llm_config", {
        baseUrl: baseUrl,
        apiKey: apiKey,
        model: model,
      });
      await get().loadLlmConfig();
      set({ showSettings: false });
    } catch (e) {
      console.error("保存LLM配置失败:", e);
      throw e;
    }
  },

  setShowSettings: (show: boolean) => set({ showSettings: show }),

  clearMessages: () => set({ messages: [], askError: null, lastQuestion: null }),
}));
