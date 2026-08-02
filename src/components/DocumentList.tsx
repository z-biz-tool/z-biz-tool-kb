import { useState, useEffect, useRef } from "react";
import {
  Input,
  Button,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Progress,
} from "antd";
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  DeleteOutlined,
  InboxOutlined,
  SearchOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useKnowledgeStore } from "../stores/knowledgeStore";
import type { DocumentInfo } from "../stores/knowledgeStore";

// 文档类型图标
function getDocIcon(docType: string) {
  switch (docType) {
    case "pdf":
      return <FilePdfOutlined style={{ color: "#ff4d4f", fontSize: 24 }} />;
    case "word":
    case "doc":
    case "docx":
      return <FileWordOutlined style={{ color: "#1677ff", fontSize: 24 }} />;
    default:
      return <FileTextOutlined style={{ color: "#52c41a", fontSize: 24 }} />;
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
    return `${d.getMonth() + 1}/${d.getDate()} ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// 状态信息
function getStatusInfo(status: string): {
  label: string;
  color: string;
  className: string;
} {
  switch (status?.toLowerCase()) {
    case "ready":
    case "ok":
    case "done":
      return { label: "就绪", color: "success", className: "status-dot ready" };
    case "processing":
    case "pending":
    case "loading":
      return {
        label: "处理中",
        color: "warning",
        className: "status-dot processing",
      };
    case "failed":
    case "error":
      return { label: "失败", color: "error", className: "status-dot failed" };
    default:
      return { label: "就绪", color: "success", className: "status-dot ready" };
  }
}

export default function DocumentList() {
  const documents = useKnowledgeStore((s) => s.documents);
  const loadingDocs = useKnowledgeStore((s) => s.loadingDocs);
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const uploadDocument = useKnowledgeStore((s) => s.uploadDocument);
  const deleteDocument = useKnowledgeStore((s) => s.deleteDocument);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const uploadZoneRef = useRef<HTMLDivElement>(null);

  // 过滤文档
  const filteredDocs = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  // 上传文件
  const handleUpload = async (filePath: string, fileName: string) => {
    setUploading(true);
    setUploadProgress(10);
    try {
      setUploadProgress(40);
      await uploadDocument(filePath, fileName);
      setUploadProgress(100);
    } catch (e) {
      console.error("上传文档失败:", e);
      throw e;
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 600);
    }
  };

  // 选择文件上传
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
        const fileName =
          selected.split("/").pop() || selected.split("\\").pop() || "unknown";
        await handleUpload(selected, fileName);
      }
    } catch {
      // error handled in handleUpload
    }
  };

  // 删除文档
  const handleDelete = async (doc: DocumentInfo) => {
    try {
      await deleteDocument(doc.id);
    } catch {
      // error logged in store
    }
  };

  // 拖拽处理
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Tauri 环境中 file.path 可能有值
      const filePath = (file as any).path || "";
      if (filePath) {
        await handleUpload(filePath, file.name);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  return (
    <div className="doc-sidebar">
      {/* 顶部标题 */}
      <div className="doc-sidebar-header">
        <FileTextOutlined style={{ fontSize: 18, color: "#1677ff" }} />
        <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
          文档库
        </span>
        {documents.length > 0 && (
          <Tag color="blue" style={{ fontSize: 11 }}>
            {documents.length} 篇
          </Tag>
        )}
        <Tooltip title="刷新">
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => loadDocuments()}
          />
        </Tooltip>
      </div>

      {/* 搜索框 */}
      <div className="doc-search">
        <Input
          prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="搜索文档..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear
          size="middle"
        />
      </div>

      {/* 拖拽上传区域 */}
      <div
        ref={uploadZoneRef}
        className={`upload-zone ${dragOver ? "dragging" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleSelectFile}
      >
        {uploading ? (
          <div>
            <Progress
              percent={uploadProgress}
              size="small"
              status="active"
              style={{ marginBottom: 4 }}
            />
            <div style={{ fontSize: 12, color: "#1677ff" }}>上传中...</div>
          </div>
        ) : (
          <>
            <InboxOutlined className="upload-zone-icon" />
            <div className="upload-zone-text">点击或拖拽文件上传</div>
            <div className="upload-zone-hint">
              支持 PDF / Word / TXT / MD
            </div>
          </>
        )}
      </div>

      {/* 文档列表 */}
      <div className="doc-list-container">
        {loadingDocs ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <Spin />
          </div>
        ) : filteredDocs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              searchKeyword ? "未找到匹配的文档" : "暂无文档，上传开始使用"
            }
            style={{ marginTop: "40px" }}
          />
        ) : (
          filteredDocs.map((doc) => {
            const statusInfo = getStatusInfo(doc.status);
            return (
              <div key={doc.id} className="doc-card">
                <span className="doc-card-icon">{getDocIcon(doc.doc_type)}</span>
                <div className="doc-card-info">
                  <div className="doc-card-name" title={doc.name}>
                    {doc.name}
                  </div>
                  <div className="doc-card-meta">
                    <span
                      className={`status-dot ${statusInfo.className
                        .replace("status-dot ", "")
                        .replace("status-dot", "")}`}
                    />
                    <span>{statusInfo.label}</span>
                    <span>·</span>
                    <span>{formatSize(doc.size)}</span>
                    <span>·</span>
                    <span>{doc.chunk_count} 切片</span>
                    <span>·</span>
                    <span>{formatTime(doc.created_at)}</span>
                  </div>
                </div>
                <Tooltip title="删除">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(doc);
                    }}
                  />
                </Tooltip>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
