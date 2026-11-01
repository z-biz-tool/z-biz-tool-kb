# z-biz-tool-kb

> 🪦 **本仓已归档（2026-11-01）：协议层已摘除 `kb` 产品 id，不再发版、不再接受任何改动。**
> 最后一个功能版本是 v0.2.2（应用内含「已并入 ZenNote」迁移提示）。
>
> 用户要的是「一个能问自己笔记的东西」，而不是装两个 app 拼出来。kb 的能力
> 已经按下面的去向全部搬完：
>
> | kb 原有能力 | 去向 |
> | --- | --- |
> | BM25 检索（中文一元+二元分词、IDF 加权、稳定排序） | `note/src-tauri/src/rag/bm25.rs`（含测试） |
> | 文本切片 | 重写为按 Markdown 结构切（`rag/chunk.rs`）：标题路径 + 段落边界 + 代码块不切半 |
> | 问答 + 引用溯源 | `ask_notes` 命令 + note 的「问笔记」面板，引用可点回原文对应段落 |
> | OpenAI 兼容调用 | cap-llm（家族统一 AI 接入层），kb 自己那份 `call_llm` 删除 |
> | PDF/Word/PPT 上传问答 | **已迁移（2026-11-01）**：解析原语进 cap-doc（pdf 现成 + 新增 `ooxml` 模块 docx/pptx）；note 的 pdf/docx 查看器「转为笔记」入口把外部文档收进检索语料 |
>
> 家族协议位：`cap-hub::PRODUCT_IDS` / `shared::ProductId` / lead 对账与
> bootstrap manifest 均已同步摘除（归档仓豁免见 lead reconcile 的
> `RETIRED_REPOS`）。cap-llm-config 的**迁移源保留**——存量用户的明文
> Key 还要从旧 kb 数据目录迁到统一落点。

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
