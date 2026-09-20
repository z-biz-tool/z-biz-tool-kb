import type { ReactNode } from "react";
import { Button, Space, Typography, theme, ConfigProvider } from "antd";
import { BulbOutlined, BulbFilled } from "@ant-design/icons";
import { useTheme } from "./ThemeContext";
import zhCN from "antd/locale/zh_CN";

const { Header, Sider, Content } = Layout;
const brandGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const cardBgGradient = "linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)";

interface AppShellProps {
  title: string;
  icon?: ReactNode;
  sidebar: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  siderWidth?: number;
}

export function AppShell({
  title,
  icon,
  sidebar,
  headerExtra,
  children,
  siderWidth = 220,
}: AppShellProps) {
  const { mode, toggle } = useTheme();
  const { token } = theme.useToken();
  
  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ height: "100vh" }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            height: 48,
            background: cardBgGradient,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Space size={8}>
            <span style={{ 
              fontSize: 20,
              background: brandGradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              {icon}
            </span>
            <Typography.Text 
              strong 
              style={{ 
                fontSize: 15,
                background: brandGradient,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {title}
            </Typography.Text>
          </Space>
          <Space>
            {headerExtra}
            <Button
              type="text"
              icon={mode === "dark" ? <BulbFilled /> : <BulbOutlined />}
              onClick={toggle}
              title={mode === "dark" ? "切换到亮色" : "切换到暗色"}
              style={{
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(102,126,234,0.2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            />
          </Space>
        </Header>
        <Layout>
          <Sider
            width={siderWidth}
            style={{
              background: cardBgGradient,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              overflow: "auto",
            }}
          >
            {sidebar}
          </Sider>
          <Content style={{ overflow: "auto", background: token.colorBgLayout }}>{children}</Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
