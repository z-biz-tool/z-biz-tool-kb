import { useEffect, useState } from "react";
import { Layout, Button, Tooltip, ConfigProvider, theme } from "antd";
import {
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";

import DocumentList from "./components/DocumentList";
import ChatPanel from "./components/ChatPanel";
import { LlmSettingsModal } from "./components/UploadButton";
import { useKnowledgeStore } from "./stores/knowledgeStore";

const { Sider, Content } = Layout;

export default function App() {
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const loadLlmConfig = useKnowledgeStore((s) => s.loadLlmConfig);
  const setShowSettings = useKnowledgeStore((s) => s.setShowSettings);

  useEffect(() => {
    loadDocuments();
    loadLlmConfig();
  }, [loadDocuments, loadLlmConfig]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorPrimary: "#1677ff", borderRadius: 8 },
      }}
    >
      <Layout style={{ height: "100vh" }}>
        <Sider
          width={360}
          collapsible
          collapsed={collapsed}
          collapsedWidth={0}
          trigger={null}
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            overflow: "hidden",
          }}
        >
          <DocumentList />
        </Sider>
        <Layout>
          <Content
            style={{
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* 折叠按钮 - 浮动在左侧 */}
            <Tooltip title={collapsed ? "展开文档库" : "收起文档库"}>
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{
                  position: "absolute",
                  left: 8,
                  top: 12,
                  zIndex: 10,
                }}
              />
            </Tooltip>

            {/* LLM设置按钮 - 浮动在右上 */}
            <Tooltip title="LLM配置">
              <Button
                type="text"
                icon={<SettingOutlined />}
                onClick={() => setShowSettings(true)}
                style={{
                  position: "absolute",
                  right: 16,
                  top: 12,
                  zIndex: 10,
                }}
              />
            </Tooltip>

            <ChatPanel />
          </Content>
        </Layout>
      </Layout>

      <LlmSettingsModal />
    </ConfigProvider>
  );
}
