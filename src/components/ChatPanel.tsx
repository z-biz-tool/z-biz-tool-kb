import { useState, useRef, useEffect } from "react";
import { Input, Button, Typography, Empty, Spin, Tag, Tooltip, Divider } from "antd";
import { SendOutlined, ClearOutlined } from "@ant-design/icons";
import { useKnowledgeStore } from "../stores/knowledgeStore";
import type { Citation } from "../stores/knowledgeStore";

const { Text, Paragraph } = Typography;

function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="citation-card">
      <div style={{ marginBottom: 4 }}>
        <Tag color="blue" style={{ fontSize: 10 }}>
          {citation.doc_name}
        </Tag>
        <span style={{ color: "#999", fontSize: 10 }}>
          切片#{citation.chunk_index} · 相关度 {(citation.score * 10).toFixed(1)}%
        </span>
      </div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        {citation.text}
        {citation.text.length >= 200 ? "..." : ""}
      </Text>
    </div>
  );
}

export default function ChatPanel() {
  const messages = useKnowledgeStore((s) => s.messages);
  const asking = useKnowledgeStore((s) => s.asking);
  const askQuestion = useKnowledgeStore((s) => s.askQuestion);
  const clearMessages = useKnowledgeStore((s) => s.clearMessages);
  const documents = useKnowledgeStore((s) => s.documents);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 顶部标题栏 */}
      <div
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <Text strong style={{ fontSize: 16 }}>
            RAG 知识问答
          </Text>
          {documents.length > 0 && (
            <Tag color="green" style={{ marginLeft: 8 }}>
              {documents.length} 篇文档
            </Tag>
          )}
        </div>
        {messages.length > 0 && (
          <Tooltip title="清空对话">
            <Button
              type="text"
              icon={<ClearOutlined />}
              onClick={clearMessages}
            />
          </Tooltip>
        )}
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
        {messages.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Empty
              description={
                documents.length === 0
                  ? "请先在左侧上传文档，然后开始问答"
                  : "输入问题开始知识库问答"
              }
            />
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i}>
                <div className={msg.role === "user" ? "chat-message-user" : "chat-message-assistant"}>
                  <div className="message-bubble">
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                  </div>
                </div>
                {/* 引用溯源 - 只在助手消息有引用时显示 */}
                {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                  <div style={{ marginBottom: 16, marginLeft: 8 }}>
                    <Divider style={{ margin: "4px 0 8px" }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>
                      📎 引用溯源 ({msg.citations.length})
                    </Text>
                    {msg.citations.map((cit, j) => (
                      <CitationCard key={j} citation={cit} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {asking && (
              <div className="chat-message-assistant">
                <div className="message-bubble">
                  <Spin size="small" /> <span style={{ marginLeft: 8 }}>正在检索知识库并生成回答...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入区 */}
      <div
        style={{
          padding: "16px 24px",
          borderTop: "1px solid #f0f0f0",
          flexShrink: 0,
        }}
      >
        <Input.Group compact style={{ display: "flex" }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter发送，Shift+Enter换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={asking}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={asking}
            disabled={!input.trim()}
            style={{ height: "auto" }}
          >
            发送
          </Button>
        </Input.Group>
      </div>
    </div>
  );
}
