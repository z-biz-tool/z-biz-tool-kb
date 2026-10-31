import { useCallback, useEffect, useState } from "react";
import { Button, Tooltip, ConfigProvider, message } from "antd";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startDeepLinkReceiver, ZBIZ_TAKE_PENDING } from "z-biz-tool-shared/protocol";
import type { Handoff } from "z-biz-tool-shared/protocol";
import { resolveKbDeepLink } from "./_shared/deepLink";
import {
  SettingOutlined,
  BookOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";

import DocumentList from "./components/DocumentList";
import ChatPanel from "./components/ChatPanel";
import UploadButton, { LlmSettingsModal } from "./components/UploadButton";
import { useKnowledgeStore } from "./stores/knowledgeStore";
import { ThemeProvider, AppShell } from "./_shared";

const UI_PREFS_KEY = "z-biz-tool-kb-ui-prefs";

interface UiPrefs {
  sidebarCollapsed: boolean;
}

function readPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return { sidebarCollapsed: false };
    const saved = JSON.parse(raw) as Partial<UiPrefs>;
    return { sidebarCollapsed: !!saved.sidebarCollapsed };
  } catch {
    // 读不出来就用默认布局，别把启动卡在一屏空白上
    return { sidebarCollapsed: false };
  }
}

export default function App() {
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const loadLlmConfig = useKnowledgeStore((s) => s.loadLlmConfig);
  const setShowSettings = useKnowledgeStore((s) => s.setShowSettings);
  const setPendingDocId = useKnowledgeStore((s) => s.setPendingDocId);
  const setDraft = useKnowledgeStore((s) => s.setDraft);
  const [collapsed, setCollapsed] = useState(() => readPrefs().sidebarCollapsed);

  // 家族深链（zbiz://kb/open?doc=… / zbiz://kb/ask?q=…）：box 等产品递过来的意图。
  // 机制收敛到共享层 startDeepLinkReceiver（冷启动补取 + 二次唤起 + 不静默吞掉），
  // 本仓只把语义落地：open 填 pendingDocId，ask 填提问框。
  useEffect(() => {
    const stop = startDeepLinkReceiver({
      productId: "kb",
      invoke: () => invoke<Handoff[]>(ZBIZ_TAKE_PENDING),
      listen: (event, handler) => listen(event, handler),
      translate: (item) => {
        const out = resolveKbDeepLink(item);
        if (out.problem) return { ok: false, problem: out.problem };
        return {
          ok: true,
          effect: { docId: out.docId, docName: out.docName, question: out.question, from: out.from },
        };
      },
      onProblem: (msg) => { message.warning(msg); },
      onEffect: (effect) => {
        const docId = (effect.docId as string | null) ?? null;
        const question = (effect.question as string | null) ?? null;
        if (docId) setPendingDocId(docId);
        if (question) setDraft(question);
      },
      log: (msg, item) => console.debug("[kb] 深链", msg, item),
    });
    return () => { stop(); };
  }, [setPendingDocId, setDraft]);

  const openSettings = useCallback(() => {
    // 每次打开都重读一次，避免展示启动时的旧配置
    void loadLlmConfig();
    setShowSettings(true);
  }, [loadLlmConfig, setShowSettings]);

  useEffect(() => {
    loadDocuments();
    loadLlmConfig();
  }, [loadDocuments, loadLlmConfig]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ sidebarCollapsed: collapsed }));
      } catch {
        /* 存不下不影响干活 */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // 弹层打开时全局快捷键不抢焦点
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (k === ",") {
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings]);

  const headerExtra = (
    <>
      <Tooltip title="显示/隐藏文档库（⌘/Ctrl+B）">
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          aria-label={collapsed ? "展开文档库" : "收起文档库"}
          onClick={() => setCollapsed((c) => !c)}
        />
      </Tooltip>
      <Tooltip title="LLM 配置（⌘/Ctrl+,）">
        <Button
          type="text"
          icon={<SettingOutlined />}
          aria-label="打开 LLM 配置"
          onClick={openSettings}
        />
      </Tooltip>
    </>
  );

  const sidebar = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8, padding: 12 }}>
      <UploadButton />
      <div style={{ flex: 1, minHeight: 0 }}>
        <DocumentList />
      </div>
    </div>
  );

  return (
    <ThemeProvider>
      <ConfigProvider locale={zhCN}>
        <AppShell
          title="z-biz-tool-kb"
          icon={<BookOutlined />}
          sidebar={sidebar}
          sidebarCollapsed={collapsed}
          headerExtra={headerExtra}
          siderWidth={320}
        >
          <ChatPanel />
          <LlmSettingsModal />
        </AppShell>
      </ConfigProvider>
    </ThemeProvider>
  );
}
