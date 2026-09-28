import { useEffect, useState } from "react";
import { Button, Tooltip, ConfigProvider } from "antd";
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
  const [collapsed, setCollapsed] = useState(() => readPrefs().sidebarCollapsed);

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
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (k === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowSettings]);

  const headerExtra = (
    <>
      <Tooltip title="显示/隐藏文档库（⌘/Ctrl+B）">
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setCollapsed((c) => !c)}
        />
      </Tooltip>
      <Tooltip title="LLM 配置（⌘/Ctrl+,）">
        <Button type="text" icon={<SettingOutlined />} onClick={() => setShowSettings(true)} />
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
