import { useEffect, useState } from "react";
import { Alert, Button, Modal, Form, Input, message, Spin, Tag, Tooltip } from "antd";
import {
  UploadOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useKnowledgeStore, toMessage } from "../stores/knowledgeStore";

const brandGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const cardBgGradient = "linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)";

type FileStatus = "pending" | "ok" | "failed";

interface UploadTask {
  name: string;
  status: FileStatus;
  error?: string;
}

function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

const STATUS_ICON: Record<FileStatus, React.ReactNode> = {
  pending: <LoadingOutlined spin />,
  ok: <CheckCircleOutlined />,
  failed: <CloseCircleOutlined />,
};

const STATUS_COLOR: Record<FileStatus, string> = {
  pending: "processing",
  ok: "success",
  failed: "error",
};

// 上传按钮组件（多选 + 逐文件真实状态；后端无进度信号，故只显示在/不在）
export default function UploadButton() {
  const uploadDocument = useKnowledgeStore((s) => s.uploadDocument);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const uploading = tasks.some((t) => t.status === "pending");

  const handleSelectFile = async () => {
    if (uploading) return;

    let paths: string[] = [];
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "文档", extensions: ["pdf", "doc", "docx", "txt", "md"] }],
      });
      if (!selected) return;
      paths = (Array.isArray(selected) ? selected : [selected]).filter(
        (p): p is string => typeof p === "string" && p.length > 0
      );
    } catch (e) {
      message.error(`选择文件失败：${toMessage(e)}`);
      return;
    }
    if (paths.length === 0) return;

    const results: UploadTask[] = paths.map((p) => ({ name: baseName(p), status: "pending" }));
    setTasks(results);

    for (let i = 0; i < paths.length; i++) {
      try {
        await uploadDocument(paths[i], results[i].name);
        results[i] = { ...results[i], status: "ok" };
      } catch (e) {
        // 提取失败的具体原因（扫描件/旧版 .doc 等）由后端给出，必须让用户看到
        results[i] = { ...results[i], status: "failed", error: toMessage(e) };
      }
      setTasks([...results]);
    }

    const failed = results.filter((r) => r.status === "failed").length;
    if (failed === 0) message.success(`${results.length} 篇已入库`);
    else message.error(`${results.length - failed} 篇成功，${failed} 篇失败（原因见列表）`);
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
        {uploading ? "解析中..." : "上传文档"}
      </Button>
      {uploading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 10,
            fontSize: 11,
            color: "var(--ant-color-text-secondary)",
          }}
        >
          <Spin size="small" />
          正在提取文本并切片入库，大文件会久一些
        </div>
      )}
      {tasks.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {tasks.map((task, i) => (
            <div key={`${task.name}-${i}`}>
              <Tooltip title={task.status === "failed" ? task.error : task.name}>
                <Tag
                  icon={STATUS_ICON[task.status]}
                  color={STATUS_COLOR[task.status]}
                  style={{
                    fontSize: 11,
                    borderRadius: 4,
                    display: "block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginInlineEnd: 0,
                  }}
                >
                  {task.name}
                </Tag>
              </Tooltip>
              {task.status === "failed" && task.error && (
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: "#ff4d4f",
                    marginTop: 2,
                    wordBreak: "break-word",
                  }}
                >
                  {task.error}
                </div>
              )}
            </div>
          ))}
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
  const llmConfigError = useKnowledgeStore((s) => s.llmConfigError);
  const [saving, setSaving] = useState(false);

  // antd 的 Esc 只在焦点落在弹层内时生效，这里无条件兜住
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, saving, setShowSettings]);

  const handleSave = async () => {
    // validateFields 失败时 antd 已在字段上标红，这里只关心真正的保存异常
    const values = (await form.validateFields().catch(() => null)) as {
      baseUrl: string;
      apiKey: string;
      model: string;
    } | null;
    if (!values) return;
    setSaving(true);
    try {
      await setLlmConfig(values.baseUrl, values.apiKey, values.model);
      message.success("配置已保存");
    } catch (e) {
      message.error("保存失败：" + toMessage(e));
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
    >
      {llmConfigError && (
        <Alert
          type="error"
          showIcon
          message="读取现有配置失败"
          description={llmConfigError}
          style={{ marginBottom: 16 }}
        />
      )}
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
