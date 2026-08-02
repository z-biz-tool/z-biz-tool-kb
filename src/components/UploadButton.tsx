import { useState } from "react";
import { Button, Modal, Form, Input, message } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { useKnowledgeStore } from "../stores/knowledgeStore";

export default function UploadButton() {
  // 这个组件实际上处理设置弹窗
  // UploadButton 在 DocumentList 中通过 antd Upload.Dragger 实现
  return null;
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
      message.error("保存失败: " + e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="LLM API 配置"
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
