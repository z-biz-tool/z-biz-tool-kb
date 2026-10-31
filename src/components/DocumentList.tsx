import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Input,
  Popconfirm,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  FileOutlined,
} from "@ant-design/icons";
import { useKnowledgeStore, toMessage } from "../stores/knowledgeStore";
import type { DocumentDetail, DocumentInfo } from "../stores/knowledgeStore";
import { EmptyState } from "../_shared";
import {
  detailTruncationNote,
  formatSize,
  formatTime,
  getStatusInfo,
} from "../lib/docView";

const brandGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const cardBgGradient = "linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)";

const { Text } = Typography;

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

export default function DocumentList() {
  const documents = useKnowledgeStore((s) => s.documents);
  const loadingDocs = useKnowledgeStore((s) => s.loadingDocs);
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const getDocumentDetail = useKnowledgeStore((s) => s.getDocumentDetail);
  const deleteDocument = useKnowledgeStore((s) => s.deleteDocument);
  const docsError = useKnowledgeStore((s) => s.docsError);
  const pendingDoc = useKnowledgeStore((s) => s.pendingDoc);
  const setPendingDoc = useKnowledgeStore((s) => s.setPendingDoc);
  const docsLoaded = useKnowledgeStore((s) => s.docsLoaded);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingRef = useRef<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDoc, setDetailDoc] = useState<DocumentInfo | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // 请求序号：快速点开另一篇或关闭抽屉后，旧请求的结果必须丢掉
  const detailReqRef = useRef(0);
  // 关闭抽屉后把焦点还给触发它的卡片，键盘用户不会掉到 body
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  // 过滤文档
  const filteredDocs = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const openDetail = async (doc: DocumentInfo) => {
    const req = ++detailReqRef.current;
    if (document.activeElement instanceof HTMLElement) {
      detailTriggerRef.current = document.activeElement;
    }
    setDetailDoc(doc);
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const result = await getDocumentDetail(doc.id);
      if (req !== detailReqRef.current) return;
      setDetail(result);
    } catch (e) {
      if (req !== detailReqRef.current) return;
      setDetailError(toMessage(e));
    } finally {
      if (req === detailReqRef.current) setDetailLoading(false);
    }
  };

  // 家族深链（zbiz://kb/open?doc=… 或 ?name=…）请求打开某篇文档。
  //
  // 文档列表是异步加载的，所以 pendingDoc 可以先挂着；列表到位后在这里匹配并打开抽屉。
  // 匹配时 id 优先、name 兜底 —— 发深链的人（box / note）往往只拿得到文件名。
  //
  // 找不到时**必须**清掉 pendingDoc 并给出可见提示：留着它，下次列表一变就会再匹配一次，
  // 而用户那边始终是「点了没反应」，无从判断是文件名写错了还是压根没入库。
  useEffect(() => {
    if (!pendingDoc) return;
    if (!docsLoaded) return; // 列表还没加载完，先挂着

    const { id, name } = pendingDoc;
    const doc =
      (id ? documents.find((d) => d.id === id) : undefined) ??
      (name ? documents.find((d) => d.name === name) : undefined);

    if (!doc) {
      message.warning(`库里没有找到这篇文档：${name ?? id ?? ""}`);
      setPendingDoc(null);
      return;
    }
    void openDetail(doc);
    setPendingDoc(null);
  }, [pendingDoc, documents, docsLoaded, openDetail, setPendingDoc]);

  const closeDetail = () => {
    // 让在途请求的结果失效，避免关闭后回写已关闭的视图
    detailReqRef.current += 1;
    setDetailOpen(false);
    setDetailLoading(false);
  };

  // afterOpenChange 在无动画环境下不会触发，这里兜底：只有焦点丢了才还给卡片
  useEffect(() => {
    if (detailOpen) return;
    const trigger = detailTriggerRef.current;
    if (!trigger || !document.contains(trigger)) return;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      const lostFocus =
        !active ||
        active === document.body ||
        (active instanceof Element && active.closest(".ant-drawer") !== null);
      if (lostFocus && document.contains(trigger)) trigger.focus();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [detailOpen]);

  // 删除文档
  const handleDelete = async (doc: DocumentInfo) => {
    if (deletingRef.current) return;
    deletingRef.current = doc.id;
    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id);
      message.success(`已删除「${doc.name}」`);
      if (detailDoc?.id === doc.id) closeDetail();
    } catch (e) {
      message.error(`删除「${doc.name}」失败：${toMessage(e)}`);
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const detailMeta = detail?.meta ?? detailDoc;
  const detailStatus = detailMeta ? getStatusInfo(detailMeta.status) : null;
  const truncationNote = detail
    ? detailTruncationNote(detail.chunks.length, detail.total_chunks)
    : null;

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
            loading={loadingDocs}
            aria-label="刷新文档列表"
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

      {docsError && !loadingDocs && (
        <Alert
          type="error"
          showIcon
          title="文档列表加载失败"
          description={docsError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => loadDocuments()}>
              重试
            </Button>
          }
          style={{ marginBottom: 10, borderRadius: 8 }}
        />
      )}

      {/* 搜索框 - 焦点阴影增强 */}
      <div className="doc-search" style={{ marginBottom: 10 }}>
        <Input
          prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="搜索文档..."
          aria-label="搜索文档"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          allowClear={{
            clearIcon: (
              <span role="img" aria-label="清空搜索">
                ×
              </span>
            ),
          }}
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
            {searchKeyword && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <Button size="small" onClick={() => setSearchKeyword("")}>
                  清空搜索
                </Button>
              </div>
            )}
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
              role="button"
              tabIndex={0}
              aria-label={`查看「${doc.name}」详情`}
              onClick={() => openDetail(doc)}
              onKeyDown={(e) => {
                // 删除按钮等内部元素收到 Enter 时不该顺带打开详情
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void openDetail(doc);
                }
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
                <Popconfirm
                  title="删除这篇文档？"
                  description={`「${doc.name}」及其 ${doc.chunk_count} 个切片索引会一并删除，无法恢复。`}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  cancelButtonProps={{ autoFocus: true }}
                  disabled={deletingId !== null}
                  onConfirm={() => handleDelete(doc)}
                >
                  <Tooltip title={deletingId === doc.id ? "正在删除" : "删除"}>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingId === doc.id}
                      disabled={deletingId !== null && deletingId !== doc.id}
                      aria-label={`删除「${doc.name}」`}
                      onClick={(e) => e.stopPropagation()}
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
                </Popconfirm>
              </div>
            );
          })
        )}
      </div>

      <Drawer
        title={detailMeta ? `「${detailMeta.name}」` : "文档详情"}
        open={detailOpen}
        onClose={closeDetail}
        afterOpenChange={(open) => {
          if (!open) detailTriggerRef.current?.focus();
        }}
        size={520}
        destroyOnHidden
        styles={{ body: { padding: 16 } }}
        extra={
          detailStatus ? (
            <Tag color={detailStatus.className === "failed" ? "error" : "blue"}>
              {detailStatus.label}
            </Tag>
          ) : null
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <Spin description="读取文档详情..." />
          </div>
        ) : detailError ? (
          <Alert
            type="error"
            showIcon
            title="文档详情加载失败"
            description={detailError}
            action={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => detailDoc && openDetail(detailDoc)}
              >
                重试
              </Button>
            }
          />
        ) : detail && detailMeta ? (
          <>
            <Descriptions
              size="small"
              column={2}
              items={[
                { key: "type", label: "类型", children: detailMeta.doc_type || "—" },
                { key: "size", label: "大小", children: formatSize(detailMeta.size) },
                { key: "chunks", label: "切片", children: `${detail.total_chunks} 个` },
                { key: "created", label: "入库时间", children: formatTime(detailMeta.created_at) },
              ]}
            />

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: "20px 0 8px",
            }}>
              <Text strong>内容预览</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {detail.total_chunks} 个切片
              </Text>
            </div>

            {truncationNote && (
              <Alert
                type="info"
                showIcon
                title={truncationNote}
                style={{ marginBottom: 10 }}
              />
            )}

            {detail.chunks.length === 0 ? (
              <EmptyState
                icon={<FileTextOutlined style={{ fontSize: 40, color: "#bfbfbf" }} />}
                title="没有可预览的切片"
                description="这份文档尚未切出入库内容"
              />
            ) : (
              detail.chunks.map((chunk) => (
                <div
                  key={chunk.index}
                  style={{
                    background: cardBgGradient,
                    border: "1px solid rgba(102,126,234,0.15)",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
                      #{chunk.index}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                      {chunk.text.length} 字
                    </Text>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {chunk.text}
                  </div>
                </div>
              ))
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
