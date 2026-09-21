import { useState, useRef, useEffect } from "react";
import { Input, Button, Typography, Tag, Tooltip, Space } from "antd";
import {
  SendOutlined,
  ClearOutlined,
  RobotOutlined,
  PaperClipOutlined,
  DownOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useKnowledgeStore } from "../stores/knowledgeStore";
import type { Citation, ChatMessage } from "../stores/knowledgeStore";
import { EmptyState, ErrorState } from "../_shared";

const brandGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const cardBgGradient = "linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)";

const { Text } = Typography;

// 建议问题
const suggestions = [
  "帮我总结文档的核心要点",
  "文档中提到了哪些关键概念？",
  "根据文档内容，列出主要结论",
];

// 简单 Markdown 渲染（用 pre + 换行处理）
function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  lines.forEach((line, idx) => {
    // 代码块处理
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(<pre key={`code-${idx}`}>{codeBuffer.join("\n")}</pre>);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    // 标题
    if (line.startsWith("### ")) {
      elements.push(<h3 key={`h3-${idx}`}>{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={`h2-${idx}`}>{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={`h1-${idx}`}>{line.slice(2)}</h1>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      // 列表项
      elements.push(
        <div key={`li-${idx}`} style={{ marginLeft: 4 }}>
          • {renderInlineCode(line.slice(2))}
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      // 有序列表
      const match = line.match(/^(\d+)\.\s(.*)/);
      if (match) {
        elements.push(
          <div key={`ol-${idx}`} style={{ marginLeft: 4 }}>
            {match[1]}. {renderInlineCode(match[2])}
          </div>
        );
      }
    } else if (line.trim() === "") {
      elements.push(<br key={`br-${idx}`} />);
    } else {
      elements.push(<p key={`p-${idx}`}>{renderInlineCode(line)}</p>);
    }
  });

  // 如果还有未关闭的代码块
  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(<pre key="code-final">{codeBuffer.join("\n")}</pre>);
  }

  return <div className="md-content">{elements}</div>;
}

// 内联代码处理
function renderInlineCode(text: string): React.ReactNode {
  const parts = text.split("`");
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <code key={i}>{part}</code>;
    }
    return part;
  });
}

// 引用溯源卡片：展开后显示完整内容（不截断）
function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = citation.text.length > 150;

  return (
    <div
      className={`citation-card ${expanded ? "expanded" : ""}`}
      onClick={() => isLong && setExpanded(!expanded)}
      style={{
        background: cardBgGradient,
        borderRadius: 8,
        padding: 10,
        border: `1px solid rgba(102,126,234,0.15)`,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(102,126,234,0.15)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.3)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.15)";
      }}
    >
      <div className="citation-meta" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Tag color="blue" style={{ fontSize: 10, margin: 0, borderRadius: 3 }}>
          {citation.doc_name}
        </Tag>
        <span style={{ color: "var(--ant-color-text-tertiary)", fontSize: 10 }}>
          切片 #{citation.chunk_index} · 相关度 {(citation.score * 100).toFixed(1)}%
        </span>
        {isLong && (
          <span style={{ color: "#667eea", fontSize: 10, marginLeft: "auto", cursor: "pointer" }}>
            {expanded ? "收起" : "展开"}
          </span>
        )}
      </div>
      <div
        className={isLong && !expanded ? "citation-text-collapsed" : ""}
        style={{ fontSize: 11, lineHeight: 1.6 }}
      >
        {citation.text}
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: "var(--ant-color-text-quaternary)" }}>
        引用 #{index + 1}
      </div>
    </div>
  );
}

// 引用溯源区域
function CitationsSection({ citations }: { citations: Citation[] }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="citations-section" style={{ marginTop: 10 }}>
      <div 
        className="citation-header" 
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#667eea",
          fontWeight: 500,
          cursor: "pointer",
          padding: "6px 10px",
          background: cardBgGradient,
          borderRadius: 6,
          marginBottom: 8,
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "translateX(4px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "";
        }}
      >
        <PaperClipOutlined />
        <span>引用溯源 ({citations.length})</span>
        {collapsed ? (
          <DownOutlined style={{ fontSize: 10, marginLeft: "auto" }} />
        ) : (
          <UpOutlined style={{ fontSize: 10, marginLeft: "auto" }} />
        )}
      </div>
      {!collapsed && citations.map((cit, i) => <CitationCard key={i} citation={cit} index={i} />)}
    </div>
  );
}

// 单条消息
function MessageItem({ msg, isTyping }: { msg: ChatMessage; isTyping: boolean }) {
  const isUser = msg.role === "user";

  return (
    <>
      <div className="chat-message-wrap">
        <div className={isUser ? "chat-message-user" : "chat-message-assistant"}>
          <div className="message-bubble" style={{
            background: isUser ? cardBgGradient : "#fff",
            borderRadius: 12,
            padding: 12,
            boxShadow: isUser ? "0 2px 8px rgba(102,126,234,0.1)" : "none",
            border: isUser ? `1px solid rgba(102,126,234,0.2)` : "none",
          }}>
            {!isUser && !isTyping && (
              <div style={{ marginBottom: 4, opacity: 0.6, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ 
                  fontSize: 12,
                  background: brandGradient,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>
                  <RobotOutlined /> AI
                </span>
              </div>
            )}
            {isUser ? (
              <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
            ) : isTyping ? (
              <div className="md-content">
                {renderMarkdown(msg.content)}
                <span className="typing-cursor" />
              </div>
            ) : (
              renderMarkdown(msg.content)
            )}
          </div>
        </div>
      </div>
      {!isUser && !isTyping && msg.citations && msg.citations.length > 0 && (
        <CitationsSection citations={msg.citations} />
      )}
    </>
  );
}

export default function ChatPanel() {
  const messages = useKnowledgeStore((s) => s.messages);
  const asking = useKnowledgeStore((s) => s.asking);
  const askError = useKnowledgeStore((s) => s.askError);
  const askQuestion = useKnowledgeStore((s) => s.askQuestion);
  const retryLastQuestion = useKnowledgeStore((s) => s.retryLastQuestion);
  const clearMessages = useKnowledgeStore((s) => s.clearMessages);
  const documents = useKnowledgeStore((s) => s.documents);

  const [input, setInput] = useState("");
  const [typingMessageIdx, setTypingMessageIdx] = useState<number | null>(null);
  const [displayedText, setDisplayedText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, displayedText, asking, askError]);

  // 打字机效果：当新的 AI 消息到来时，逐字显示
  useEffect(() => {
    if (messages.length === 0) {
      setTypingMessageIdx(null);
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.content) {
      // 只对新出现的最后一条 assistant 消息执行打字效果
      setTypingMessageIdx(messages.length - 1);
      setDisplayedText("");
    }
  }, [messages]);

  // 逐字显示
  useEffect(() => {
    if (typingMessageIdx === null) return;
    const targetMsg = messages[typingMessageIdx];
    if (!targetMsg || targetMsg.role !== "assistant") return;

    const fullText = targetMsg.content;
    if (displayedText.length >= fullText.length) {
      setTypingMessageIdx(null);
      return;
    }

    typingTimerRef.current = setInterval(() => {
      setDisplayedText((prev) => {
        const next = fullText.slice(0, prev.length + 2);
        if (next.length >= fullText.length) {
          if (typingTimerRef.current) {
            clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }
          setTypingMessageIdx(null);
        }
        return next;
      });
    }, 20);

    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingMessageIdx]);

  const handleSend = (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || asking) return;
    setInput("");
    askQuestion(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 正在打字的消息
  const renderMessages = () => {
    return messages.map((msg, i) => {
      if (i === typingMessageIdx && typingMessageIdx !== null) {
        // 显示打字中的版本
        const typingMsg: ChatMessage = {
          ...msg,
          content: displayedText,
        };
        return <MessageItem key={i} msg={typingMsg} isTyping={true} />;
      }
      return <MessageItem key={i} msg={msg} isTyping={false} />;
    });
  };

  return (
    <div className="chat-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 顶部标题栏 */}
      <div className="chat-header" style={{
        padding: "14px 16px",
        borderBottom: `1px solid var(--ant-color-border-secondary)`,
        background: cardBgGradient,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderRadius: "12px 12px 0 0",
      }}>
        <Text strong style={{ 
          fontSize: 16,
          background: brandGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <RobotOutlined style={{ background: brandGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }} />
          RAG 知识问答
        </Text>
        <Space>
          {documents.length > 0 && (
            <Tag color="green" style={{ fontSize: 11, borderRadius: 4 }}>
              {documents.length} 篇文档
            </Tag>
          )}
          {messages.length > 0 && (
            <Tooltip title="清空对话">
              <Button
                type="text"
                icon={<ClearOutlined />}
                onClick={clearMessages}
                style={{
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "#ff4d4f";
                  (e.currentTarget as HTMLElement).style.transform = "scale(1.1)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "";
                  (e.currentTarget as HTMLElement).style.transform = "";
                }}
              />
            </Tooltip>
          )}
        </Space>
      </div>

      {/* 消息列表 / 空状态 */}
      <div className="chat-messages" style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {messages.length === 0 && !askError ? (
          <div className="chat-empty-wrap">
            <div className="chat-empty-top">
              <EmptyState
                icon={<RobotOutlined style={{ fontSize: 56, background: brandGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", opacity: 0.7 }} />}
                title="开始提问"
                description="向知识库提问，获取基于文档的 AI 回答"
              />
            </div>
            <div className="suggestion-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {suggestions.map((s, i) => (
                <div 
                  key={i} 
                  className="suggestion-item" 
                  onClick={() => handleSend(s)}
                  style={{
                    padding: "10px 14px",
                    background: cardBgGradient,
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--ant-color-text)",
                    border: `1px solid rgba(102,126,234,0.15)`,
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(102,126,234,0.15)";
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                    (e.currentTarget as HTMLElement).style.transform = "";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(102,126,234,0.15)";
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {renderMessages()}
            {asking && (
              <div className="chat-message-wrap">
                <div className="chat-message-assistant">
                  <div className="message-bubble" style={{
                    background: cardBgGradient,
                    borderRadius: 12,
                    padding: 12,
                    border: `1px solid rgba(102,126,234,0.2)`,
                  }}>
                    <div style={{ marginBottom: 4, opacity: 0.6, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ 
                        fontSize: 12,
                        background: brandGradient,
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}>
                        <RobotOutlined /> AI
                      </span>
                    </div>
                    <span style={{ marginRight: 8 }}>正在思考...</span>
                    <span className="typing-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </div>
              </div>
            )}
            {!asking && askError && (
              <div className="chat-message-wrap">
                <ErrorState message={askError} onRetry={() => retryLastQuestion()} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入区 */}
      <div className="chat-input-area" style={{
        padding: "14px 16px",
        borderTop: `1px solid var(--ant-color-border-secondary)`,
        background: cardBgGradient,
        borderRadius: "0 0 12px 12px",
      }}>
        <div className="chat-input-wrap" style={{
          display: "flex",
          gap: 10,
          alignItems: "stretch",
        }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={asking}
            style={{
              flex: 1,
              borderRadius: 8,
              resize: "none",
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
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => handleSend()}
            loading={asking}
            disabled={!input.trim()}
            shape="circle"
            size="large"
            style={{
              background: brandGradient,
              border: "none",
              boxShadow: "0 4px 12px rgba(102,126,234,0.3)",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 16px rgba(102,126,234,0.4)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(102,126,234,0.3)";
            }}
          />
        </div>
      </div>
    </div>
  );
}
