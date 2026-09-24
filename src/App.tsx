import { useEffect } from "react";
import { Button, Tooltip, ConfigProvider } from "antd";
import { SettingOutlined, BookOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";

import DocumentList from "./components/DocumentList";
import ChatPanel from "./components/ChatPanel";
import UploadButton, { LlmSettingsModal } from "./components/UploadButton";
import { useKnowledgeStore } from "./stores/knowledgeStore";
import { ThemeProvider, AppShell } from "./_shared";

export default function App() {
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const loadLlmConfig = useKnowledgeStore((s) => s.loadLlmConfig);
  const setShowSettings = useKnowledgeStore((s) => s.setShowSettings);

  useEffect(() => {
    loadDocuments();
    loadLlmConfig();
  }, [loadDocuments, loadLlmConfig]);

  const headerExtra = (
    <Tooltip title="LLM 配置">
      <Button type="text" icon={<SettingOutlined />} onClick={() => setShowSettings(true)} />
    </Tooltip>
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
