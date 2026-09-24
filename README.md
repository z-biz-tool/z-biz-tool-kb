# z-biz-tool-kb

知识管理 + RAG问答桌面应用，基于 Tauri 2.0 + React 19 + Ant Design 6 + TypeScript。

## 功能

- 📄 文档管理：上传 PDF / Word / TXT / MD 文档
- ✂️ 文本切片：按字数分割（500字/片，100字重叠）
- 🔍 关键词检索：中文2-gram + 英文分词匹配
- 🤖 RAG问答：调用 OpenAI 兼容 API，基于检索内容生成回答
- 📎 引用溯源：显示回答引用的文档来源和相关度

## 技术栈

- **前端**: React 19 + Ant Design 6 + Zustand 5 + Vite 6 + TypeScript
- **后端**: Rust + Tauri 2.0 + reqwest (HTTP客户端)
- **LLM**: OpenAI 兼容 API (可配置 baseUrl + apiKey + model)

## 开发

```bash
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

## LLM配置

在应用中点击右上角设置图标，配置：
- API Base URL（如 `https://api.openai.com/v1`）
- API Key
- 模型名称（如 `gpt-4o-mini`）
