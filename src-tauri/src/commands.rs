use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::rag;

/// 文档信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub doc_type: String,
    pub chunk_count: usize,
    pub created_at: String,
    pub status: String,
}

/// 入库的物理预算：解析一份百页 PDF 是 CPU 密集的分钟级工作，
/// 没有上限的话一次上传就能把应用钉死；字符上限保证检索端不会抱着一个 G 级 json 文件。
const MAX_UPLOAD_BYTES: u64 = 64 * 1024 * 1024;
const MAX_INDEX_CHARS: usize = 4_000_000;

/// 上传文档命令
#[tauri::command]
pub async fn upload_document(
    app: AppHandle,
    file_path: String,
    file_name: String,
) -> Result<DocumentInfo, String> {
    let data_dir = get_data_dir(&app)?;
    let source = PathBuf::from(&file_path);

    if !source.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }
    let file_size = std::fs::metadata(&source)
        .map_err(|e| format!("获取文件大小失败: {}", e))?
        .len();
    if file_size > MAX_UPLOAD_BYTES {
        return Err(format!(
            "这份文件 {:.1} MB，超过单次入库上限 64 MB。先拆成几份再上传，\
             大文件整体解析会长时间占住入库线程",
            file_size as f64 / 1048576.0
        ));
    }
    // 认不得的类型在这里就挡掉，不让它走到读字节那一步
    let doc_type = rag::get_doc_type(&file_name);
    if doc_type == "unknown" {
        return Err(format!(
            "{} 不是可入库的类型（支持 pdf / docx / pptx / md / txt / csv / log）",
            file_name
        ));
    }

    // 解析 + 切片 + 落盘是分钟级 CPU 活，不能留在 IPC 线程上跑
    let path = source.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let content = rag::read_file_content(&path, &doc_type)?;
        if content.chars().count() > MAX_INDEX_CHARS {
            return Err(format!(
                "这份文档取出了超过 {} 万字符的文字，超出单篇入库上限，请先拆分",
                MAX_INDEX_CHARS / 10_000
            ));
        }
        let chunks = rag::split_text(&content, 500, 100);
        if chunks.is_empty() {
            return Err("切片后没有可入库的内容".to_string());
        }
        let doc_id = format!(
            "{}_{}",
            file_name
                .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', ""),
            chrono::Utc::now().timestamp()
        );
        let doc_meta = rag::DocumentMeta {
            id: doc_id,
            name: file_name,
            size: file_size,
            doc_type,
            chunk_count: chunks.len(),
            created_at: chrono::Utc::now().to_rfc3339(),
            // status 只有在落盘成功后才写 ready —— 以前是先报 ready 再看结果
            status: "ready".to_string(),
        };
        rag::save_document(&data_dir, &doc_meta, &chunks)?;
        Ok(DocumentInfo {
            id: doc_meta.id,
            name: doc_meta.name,
            size: doc_meta.size,
            doc_type: doc_meta.doc_type,
            chunk_count: doc_meta.chunk_count,
            created_at: doc_meta.created_at,
            status: doc_meta.status,
        })
    })
    .await
    .map_err(|e| format!("入库任务被中断: {}", e))?
}

/// 列出所有文档
#[tauri::command]
pub fn list_documents(app: AppHandle) -> Result<Vec<DocumentInfo>, String> {
    let data_dir = get_data_dir(&app)?;
    let docs = rag::list_documents(&data_dir)?;
    Ok(docs
        .into_iter()
        .map(|m| DocumentInfo {
            id: m.id,
            name: m.name,
            size: m.size,
            doc_type: m.doc_type,
            chunk_count: m.chunk_count,
            created_at: m.created_at,
            status: m.status,
        })
        .collect())
}

/// 删除文档
#[tauri::command]
pub fn delete_document(app: AppHandle, doc_id: String) -> Result<(), String> {
    let data_dir = get_data_dir(&app)?;
    rag::delete_document(&data_dir, &doc_id)
}

/// 问答引用溯源
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub doc_id: String,
    pub doc_name: String,
    pub chunk_index: usize,
    pub text: String,
    pub score: f64,
}

/// 问答结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerResult {
    pub answer: String,
    pub citations: Vec<Citation>,
}

/// 发起问答
#[tauri::command]
pub async fn ask_question(
    app: AppHandle,
    question: String,
) -> Result<AnswerResult, String> {
    let data_dir = get_data_dir(&app)?;

    // BM25 检索（索引按目录指纹缓存，不再每次问答都把全部切片读一遍算裸词频）
    let (top_chunks, corpus_size) = rag::search_corpus(&data_dir, &question, 5)?;

    if corpus_size == 0 {
        return Ok(AnswerResult {
            answer: "知识库中没有文档，请先上传文档。".to_string(),
            citations: vec![],
        });
    }

    if top_chunks.is_empty() {
        return Ok(AnswerResult {
            answer: "未找到与问题相关的文档内容，请尝试其他关键词。".to_string(),
            citations: vec![],
        });
    }

    // 构建引用信息（保留完整切片文本，由前端展开查看）
    let citations: Vec<Citation> = top_chunks
        .iter()
        .map(|(chunk, score)| Citation {
            doc_id: chunk.doc_id.clone(),
            doc_name: chunk.doc_name.clone(),
            chunk_index: chunk.index,
            text: chunk.text.clone(),
            score: *score,
        })
        .collect();

    // 构建上下文
    let context = top_chunks
        .iter()
        .map(|(chunk, _)| format!("[文档: {}]\n{}", chunk.doc_name, chunk.text))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    // 加载LLM配置
    let config = rag::load_llm_config(&data_dir)?;

    // 调用LLM API
    let answer = rag::call_llm(&config, &question, &context)
        .await
        .unwrap_or_else(|e| format!("调用LLM失败: {}。以下是检索到的相关内容:\n\n{}", e, context));

    Ok(AnswerResult { answer, citations })
}

/// 获取LLM配置
#[tauri::command]
pub fn get_llm_config(app: AppHandle) -> Result<rag::LlmConfig, String> {
    let data_dir = get_data_dir(&app)?;
    rag::load_llm_config(&data_dir)
}

/// 设置LLM配置
#[tauri::command]
pub fn set_llm_config(
    app: AppHandle,
    base_url: String,
    api_key: String,
    model: String,
) -> Result<(), String> {
    let data_dir = get_data_dir(&app)?;
    let config = rag::LlmConfig {
        base_url,
        api_key,
        model,
    };
    rag::save_llm_config(&data_dir, &config)
}

/// 获取应用数据目录
fn get_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))
}
