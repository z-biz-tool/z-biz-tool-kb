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

const brandGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const cardBgGradient = "linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)";

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
      {/* 顶部标题 - 卡片化设计 */}
      <div className="doc-sidebar-header" style={{
        background: cardBgGradient,
        borderRadius: 12,
        padding: "12px 16px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 10,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(102,126,234,0.15)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}>
        <span style={{ 
          fontSize: 18,
          background: brandGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          <FileOutlined />
        </span>
        <span style={{ fontWeight: 600, fontSize: 15, flex: 1, background: brandGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>文档库</span>
        {documents.length > 0 && (
          <Tag color="blue" style={{ fontSize: 11, borderRadius: 4 }}>
            {documents.length} 篇
          </Tag>
        )}
        <Tooltip title="刷新">
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => loadDocuments()}
            style={{
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = "#667eea";
              (e.currentTarget as HTMLElement).style.transform = "scale(1.1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = "";
              (e.currentTarget as HTMLElement).style.transform = "";
            }}
          />
        </Tooltip>
      </div>

      {/* 搜索框 - 焦点阴影增强 */}
      <div className="doc-search" style={{ marginBottom: 10 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="搜索文档..."
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear
          size="middle"
          style={{
            borderRadius: 8,
            boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = '0 2px 12px rgba(102,126,234,0.2)';
            e.currentTarget.style.border = '1px solid rgba(102,126,234,0.3)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.04)';
            e.currentTarget.style.border = '';
          }}
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
          filteredDocs.map((doc, index) => {
            const statusInfo = getStatusInfo(doc.status);
            return (
              <div key={doc.id} className="doc-card" style={{
                background: cardBgGradient,
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                border: `1px solid rgba(102,126,234,${index % 2 === 0 ? 0.08 : 0.12})`,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(102,126,234,0.15)";
                (e.currentTarget as HTMLElement).style.transform = "translateX(4px)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.3)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
                (e.currentTarget as HTMLElement).style.transform = "";
                (e.currentTarget as HTMLElement).style.borderColor = `rgba(102,126,234,${index % 2 === 0 ? 0.08 : 0.12})`;
              }}>
                <span className="doc-card-icon">{getDocIcon(doc.doc_type)}</span>
                <div className="doc-card-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="doc-card-name" title={doc.name} style={{
                    fontWeight: 500,
                    fontSize: 13,
                    background: brandGradient,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}>
                    {doc.name}
                  </div>
                  <div className="doc-card-meta" style={{ fontSize: 11, color: "var(--ant-color-text-secondary)", marginTop: 4 }}>
                    <span className={`status-dot ${statusInfo.className}`} style={{ marginRight: 4 }} />
                    <span>{statusInfo.label}</span>
                    <span style={{ margin: "0 4px" }}>·</span>
                    <span>{formatSize(doc.size)}</span>
                    <span style={{ margin: "0 4px" }}>·</span>
                    <span>{doc.chunk_count} 切片</span>
                    <span style={{ margin: "0 4px" }}>·</span>
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
                    style={{
                      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "scale(1.1)";
                      (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(255,77,79,0.3)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = "";
                      (e.currentTarget as HTMLElement).style.boxShadow = "none";
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
