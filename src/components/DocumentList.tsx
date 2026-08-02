import { useState, useEffect } from "react";
import { Input, Button, Tag, Tooltip, Spin } from "antd";
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  FileOutlined,
} from "@ant-design/icons";
import { useKnowledgeStore } from "../stores/knowledgeStore";
import type { DocumentInfo } from "../stores/knowledgeStore";
import { EmptyState } from "../_shared";

// 文档类型图标
function getDocIcon(docType: string) {
  switch (docType) {
    case "pdf":
      return <FilePdfOutlined style={{ color: "#ff4d4f", fontSize: 24 }} />;
    case "word":
    case "doc":
    case "docx":
      return <FileWordOutlined style={{ color: "#1677ff", fontSize: 24 }} />;
    case "txt":
    case "markdown":
      return <FileTextOutlined style={{ color: "#52c41a", fontSize: 24 }} />;
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
  className: string;
} {
  switch (status?.toLowerCase()) {
    case "ready":
    case "ok":
    case "done":
      return { label: "就绪", className: "ready" };
    case "processing":
    case "pending":
    case "loading":
      return { label: "处理中", className: "processing" };
    case "failed":
    case "error":
      return { label: "失败", className: "failed" };
    default:
      return { label: "就绪", className: "ready" };
  }
}

export default function DocumentList() {
  const documents = useKnowledgeStore((s) => s.documents);
  const loadingDocs = useKnowledgeStore((s) => s.loadingDocs);
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const deleteDocument = useKnowledgeStore((s) => s.deleteDocument);

  const [searchKeyword, setSearchKeyword] = useState("");

  // 过滤文档
  const filteredDocs = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  // 删除文档
  const handleDelete = async (doc: DocumentInfo) => {
    try {
      await deleteDocument(doc.id);
    } catch {
      // error logged in store
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  return (
    <div className="doc-sidebar">
      {/* 顶部标题 */}
      <div className="doc-sidebar-header">
        <FileOutlined style={{ fontSize: 18, color: "#1677ff" }} />
        <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>文档库</span>
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

      {/* 文档列表 */}
      <div className="doc-list-container">
        {loadingDocs ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <Spin />
          </div>
        ) : filteredDocs.length === 0 ? (
          <div style={{ padding: "12px 4px" }}>
            <EmptyState
              icon={<FileTextOutlined style={{ fontSize: 48, color: "#bfbfbf" }} />}
              title={searchKeyword ? "未找到匹配的文档" : "暂无文档"}
              description={searchKeyword ? "试试其他关键词" : "上传开始构建知识库"}
            />
          </div>
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
                    <span className={`status-dot ${statusInfo.className}`} />
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
