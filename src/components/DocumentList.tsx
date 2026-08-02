import { useEffect, useState } from "react";
import { Upload, List, Button, Tag, Empty, Spin, message, Tooltip } from "antd";
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  DeleteOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useKnowledgeStore } from "../stores/knowledgeStore";
import type { DocumentInfo } from "../stores/knowledgeStore";
import { LlmSettingsModal } from "./UploadButton";

const { Dragger } = Upload;

// 文档类型图标
function getDocIcon(docType: string) {
  switch (docType) {
    case "pdf":
      return <FilePdfOutlined style={{ color: "#ff4d4f" }} />;
    case "word":
      return <FileWordOutlined style={{ color: "#1677ff" }} />;
    default:
      return <FileTextOutlined style={{ color: "#52c41a" }} />;
  }
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 格式化时间
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default function DocumentList() {
  const documents = useKnowledgeStore((s) => s.documents);
  const loadingDocs = useKnowledgeStore((s) => s.loadingDocs);
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const uploadDocument = useKnowledgeStore((s) => s.uploadDocument);
  const deleteDocument = useKnowledgeStore((s) => s.deleteDocument);
  const [uploading, setUploading] = useState(false);

  // 通过Tauri dialog选择文件并上传
  const handleSelectFile = async () => {
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
        setUploading(true);
        // 从路径中提取文件名
        const fileName = selected.split("/").pop() || selected.split("\\").pop() || "unknown";
        await uploadDocument(selected, fileName);
        message.success(`${fileName} 上传成功`);
      }
    } catch (e) {
      message.error("上传失败: " + e);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: DocumentInfo) => {
    try {
      await deleteDocument(doc.id);
      message.success(`已删除: ${doc.name}`);
    } catch (e) {
      message.error("删除失败: " + e);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  return (
    <div style={{ height: "calc(100vh - 57px)", display: "flex", flexDirection: "column" }}>
      {/* 上传区域 */}
      <div style={{ padding: "12px" }}>
        <Dragger
          accept=".pdf,.doc,.docx,.txt,.md"
          multiple={false}
          showUploadList={false}
          customRequest={() => {}}
          beforeUpload={(file) => {
            // 使用Tauri的文件路径处理
            // antd Upload在Tauri环境中无法直接获取文件路径
            // 改用按钮选择文件
            return false;
          }}
          style={{ padding: "16px" }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text" style={{ fontSize: 14 }}>
            拖拽文件到此处上传
          </p>
          <p className="ant-upload-hint" style={{ fontSize: 12 }}>
            支持 PDF / Word / TXT / MD
          </p>
        </Dragger>
        <Button
          type="primary"
          block
          loading={uploading}
          onClick={handleSelectFile}
          style={{ marginTop: 8 }}
        >
          选择文件上传
        </Button>
      </div>

      {/* 文档列表 */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 12px" }}>
        {loadingDocs ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <Spin />
          </div>
        ) : documents.length === 0 ? (
          <Empty
            description="暂无文档"
            style={{ marginTop: "40px" }}
          />
        ) : (
          <List
            dataSource={documents}
            renderItem={(doc) => (
              <List.Item
                actions={[
                  <Tooltip title="删除" key="delete">
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDelete(doc)}
                    />
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  avatar={getDocIcon(doc.doc_type)}
                  title={
                    <span style={{ fontSize: 13 }}>{doc.name}</span>
                  }
                  description={
                    <div style={{ fontSize: 11 }}>
                      <Tag color="blue" style={{ fontSize: 10 }}>
                        {doc.doc_type.toUpperCase()}
                      </Tag>
                      <span style={{ color: "#999" }}>
                        {formatSize(doc.size)} · {doc.chunk_count} 切片 · {formatTime(doc.created_at)}
                      </span>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>

      {/* LLM设置弹窗 */}
      <LlmSettingsModal />
    </div>
  );
}
