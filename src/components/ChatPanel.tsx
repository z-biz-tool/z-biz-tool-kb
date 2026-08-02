import { useState, useRef, useEffect } from "react";
import { Input, Button, Typography, Tag, Tooltip } from "antd";
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
        elements.push(
          <pre key={`code-${idx}`}>{codeBuffer.join("\n")}</pre>
        );
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

// 引用溯源卡片
function CitationCard({
  citation,
  index,
}: {
  citation: Citation;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = citation.text.length > 150;

  return (
    <div
      className={`citation-card ${expanded ? "expanded" : ""}`}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <div className="citation-meta">
        <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
          {citation.doc_name}
        </Tag>
        <span style={{ color: "#999", fontSize: 10 }}>
          切片 #{citation.chunk_index} · 相关度{" "}
          {(citation.score * 100).toFixed(1)}%
        </span>
        {isLong && (
          <span style={{ color: "#1677ff", fontSize: 10, marginLeft: "auto" }}>
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
      <div style={{ marginTop: 4, fontSize: 10, color: "#bbb" }}>
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
    <div className="citations-section">
      <div
        className="citation-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <PaperClipOutlined />
        <span>引用溯源 ({citations.length})</span>
        {collapsed ? <DownOutlined style={{ fontSize: 10 }} /> : <UpOutlined style={{ fontSize: 10 }} />}
      </div>
      {!collapsed &&
        citations.map((cit, i) => (
          <CitationCard key={i} citation={cit} index={i} />
        ))}
    </div>
  );
}

// 单条消息
function MessageItem({
  msg,
  isTyping,
}: {
  msg: ChatMessage;
  isTyping: boolean;
}) {
  const isUser = msg.role === "user";

  return (
    <>
      <div className="chat-message-wrap">
        <div className={isUser ? "chat-message-user" : "chat-message-assistant"}>
          <div className="message-bubble">
            {!isUser && !isTyping && (
              <div style={{ marginBottom: 4, opacity: 0.6 }}>
                <RobotOutlined /> AI
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
  const askQuestion = useKnowledgeStore((s) => s.askQuestion);
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
  }, [messages, displayedText]);

  // 打字机效果: 当新的AI消息到来时，逐字显示
  useEffect(() => {
    if (messages.length === 0) {
      setTypingMessageIdx(null);
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.content) {
      // 只对新出现的最后一条assistant消息执行打字效果
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
    <div className="chat-panel">
      {/* 顶部标题栏 */}
      <div className="chat-header">
        <Text strong style={{ fontSize: 16 }}>
          <RobotOutlined style={{ marginRight: 8 }} />
          RAG 知识问答
        </Text>
        {documents.length > 0 && (
          <Tag color="green" style={{ marginLeft: 12 }}>
            {documents.length} 篇文档
          </Tag>
        )}
        {messages.length > 0 && (
          <Tooltip title="清空对话">
            <Button
              type="text"
              icon={<ClearOutlined />}
              onClick={clearMessages}
              style={{ marginLeft: 8 }}
            />
          </Tooltip>
        )}
      </div>

      {/* 消息列表 / 空状态 */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <RobotOutlined className="empty-chat-icon" />
            <div className="empty-chat-title">
              {documents.length === 0
                ? "欢迎使用知识库问答"
                : "开始与你的知识库对话"}
            </div>
            <div className="empty-chat-desc">
              {documents.length === 0
                ? "请先在左侧上传文档，然后就可以基于文档内容进行智能问答了"
                : "在下方输入问题，我会基于已上传的文档为你提供精准回答"}
            </div>
            <div className="suggestion-list">
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className="suggestion-item"
                  onClick={() => handleSend(s)}
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
                  <div className="message-bubble">
                    <div style={{ marginBottom: 4, opacity: 0.6 }}>
                      <RobotOutlined /> AI
                    </div>
                    <span style={{ marginRight: 8 }}>
                      正在检索知识库
                    </span>
                    <span className="typing-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入区 */}
      <div className="chat-input-area">
        <div className="chat-input-wrap">
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter发送，Shift+Enter换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={asking}
            style={{ flex: 1, borderRadius: 18, resize: "none" }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => handleSend()}
            loading={asking}
            disabled={!input.trim()}
            shape="circle"
            size="large"
          />
        </div>
      </div>
    </div>
  );
}
