import { useState } from "react";
import { Button, Modal, Form, Input, message, Progress } from "antd";
import { UploadOutlined, SettingOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useKnowledgeStore } from "../stores/knowledgeStore";

const brandGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const cardBgGradient = "linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)";

// 上传按钮组件（点击上传 + 进度显示 + 成功/失败反馈）
export default function UploadButton() {
  const uploadDocument = useKnowledgeStore((s) => s.uploadDocument);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string>("");

  const handleSelectFile = async () => {
    if (uploading) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "文档",
            extensions: ["pdf", "doc", "docx", "txt", "md"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        const fileName = selected.split("/").pop() || selected.split("\\").pop() || "unknown";
        setCurrentFile(fileName);
        setUploading(true);
        setUploadProgress(10);

        // 模拟进度（invoke 为单次调用，无真实进度事件）
        const timer = setInterval(() => {
          setUploadProgress((p) => (p < 90 ? p + 5 : p));
        }, 200);

        try {
          setUploadProgress(40);
          await uploadDocument(selected, fileName);
          clearInterval(timer);
          setUploadProgress(100);
          message.success(`${fileName} 上传成功`);
          setTimeout(() => {
            setUploading(false);
            setUploadProgress(0);
            setCurrentFile("");
          }, 500);
        } catch (e) {
          clearInterval(timer);
          setUploading(false);
          setUploadProgress(0);
          setCurrentFile("");
          message.error(`上传失败：${e}`);
        }
      }
    } catch (e) {
      setUploading(false);
      setUploadProgress(0);
      setCurrentFile("");
      message.error(`选择文件失败：${e}`);
    }
  };

  return (
    <div style={{
      background: cardBgGradient,
      borderRadius: 10,
      padding: 12,
      border: `1px solid rgba(102,126,234,0.15)`,
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(102,126,234,0.15)";
      (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.3)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.boxShadow = "none";
      (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.15)";
    }}>
      <Button
        type="primary"
        icon={<UploadOutlined />}
        loading={uploading}
        onClick={handleSelectFile}
        block
        style={{
          background: brandGradient,
          border: "none",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(102,126,234,0.3)",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "scale(1.02)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 16px rgba(102,126,234,0.4)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(102,126,234,0.3)";
        }}
      >
        {uploading ? "上传中..." : "上传文档"}
      </Button>
      {uploading && (
        <div style={{ marginTop: 10 }}>
          {currentFile && (
            <div
              style={{
                fontSize: 11,
                color: "var(--ant-color-text-secondary)",
                marginBottom: 6,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 500,
              }}
              title={currentFile}
            >
              {currentFile}
            </div>
          )}
          <Progress 
            percent={uploadProgress} 
            size="small" 
            status="active"
            strokeColor={{
              '0%': '#667eea',
              '100%': '#764ba2',
            }}
            style={{ borderRadius: 4 }}
          />
        </div>
      )}
    </div>
  );
}

// LLM 设置弹窗组件
export function LlmSettingsModal() {
  const [form] = Form.useForm();
  const showSettings = useKnowledgeStore((s) => s.showSettings);
  const setShowSettings = useKnowledgeStore((s) => s.setShowSettings);
  const llmConfig = useKnowledgeStore((s) => s.llmConfig);
  const setLlmConfig = useKnowledgeStore((s) => s.setLlmConfig);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await setLlmConfig(values.baseUrl, values.apiKey, values.model);
      message.success("配置已保存");
    } catch (e) {
      if (e instanceof Error && e.message) {
        message.error("保存失败：" + e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <span style={{
          background: brandGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <SettingOutlined />
          LLM API 配置
        </span>
      }
      open={showSettings}
      onOk={handleSave}
      onCancel={() => setShowSettings(false)}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      style={{
        borderRadius: 12,
        overflow: "hidden",
      }}
      bodyStyle={{
        padding: "20px",
      }}
      footerStyle={{
        padding: "12px 20px",
        borderTop: `1px solid var(--ant-color-border-secondary)`,
        background: "#fafafa",
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          baseUrl: llmConfig?.base_url || "https://api.openai.com/v1",
          apiKey: llmConfig?.api_key || "",
          model: llmConfig?.model || "gpt-4o-mini",
        }}
        key={llmConfig ? llmConfig.base_url : "empty"}
      >
        <Form.Item
          name="baseUrl"
          label="API Base URL"
          rules={[{ required: true, message: "请输入 API Base URL" }]}
          style={{ marginBottom: 16 }}
        >
          <Input 
            placeholder="https://api.openai.com/v1"
            style={{
              borderRadius: 6,
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}
          />
        </Form.Item>
        <Form.Item
          name="apiKey"
          label="API Key"
          rules={[{ required: true, message: "请输入 API Key" }]}
          style={{ marginBottom: 16 }}
        >
          <Input.Password 
            placeholder="sk-..."
            style={{
              borderRadius: 6,
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}
          />
        </Form.Item>
        <Form.Item
          name="model"
          label="模型名称"
          rules={[{ required: true, message: "请输入模型名称" }]}
          style={{ marginBottom: 20 }}
        >
          <Input 
            placeholder="gpt-4o-mini"
            style={{
              borderRadius: 6,
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
