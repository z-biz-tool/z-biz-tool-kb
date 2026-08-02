import { useState } from "react";
import { Button, Modal, Form, Input, message, Progress } from "antd";
import { UploadOutlined, SettingOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useKnowledgeStore } from "../stores/knowledgeStore";

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
          message.error(`上传失败: ${e}`);
        }
      }
    } catch (e) {
      setUploading(false);
      setUploadProgress(0);
      setCurrentFile("");
      message.error(`选择文件失败: ${e}`);
    }
  };

  return (
    <div>
      <Button
        type="primary"
        icon={<UploadOutlined />}
        loading={uploading}
        onClick={handleSelectFile}
        block
      >
        {uploading ? "上传中..." : "上传文档"}
      </Button>
      {uploading && (
        <div style={{ marginTop: 6 }}>
          {currentFile && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ant-color-text-secondary)",
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={currentFile}
            >
              {currentFile}
            </div>
          )}
          <Progress percent={uploadProgress} size="small" status="active" />
        </div>
      )}
    </div>
  );
}

// LLM设置弹窗组件
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
        message.error("保存失败: " + e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          <SettingOutlined style={{ marginRight: 8 }} />
          LLM API 配置
        </span>
      }
      open={showSettings}
      onOk={handleSave}
      onCancel={() => setShowSettings(false)}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
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
          rules={[{ required: true, message: "请输入API Base URL" }]}
        >
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item
          name="apiKey"
          label="API Key"
          rules={[{ required: true, message: "请输入API Key" }]}
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Form.Item
          name="model"
          label="模型名称"
          rules={[{ required: true, message: "请输入模型名称" }]}
        >
          <Input placeholder="gpt-4o-mini" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
