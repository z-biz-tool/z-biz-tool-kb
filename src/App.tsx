import { useEffect } from "react";
import { Layout, theme } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";

import DocumentList from "./components/DocumentList";
import ChatPanel from "./components/ChatPanel";
import { useKnowledgeStore } from "./stores/knowledgeStore";

const { Sider, Content } = Layout;

export default function App() {
  const { token } = theme.useToken();
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const loadLlmConfig = useKnowledgeStore((s) => s.loadLlmConfig);
  const setShowSettings = useKnowledgeStore((s) => s.setShowSettings);

  useEffect(() => {
    loadDocuments();
    loadLlmConfig();
  }, [loadDocuments, loadLlmConfig]);

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider width={360} style={{ background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorderSecondary}` }}>
        <div style={{ padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>z-biz-tool-knowledge</span>
          <Tooltip title="LLM配置">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setShowSettings(true)}
            />
          </Tooltip>
        </div>
        <DocumentList />
      </Sider>
      <Content style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ChatPanel />
      </Content>
    </Layout>
  );
}
