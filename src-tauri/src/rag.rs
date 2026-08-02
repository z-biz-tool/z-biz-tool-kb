use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// LLM配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// 文档元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMeta {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub doc_type: String,
    pub chunk_count: usize,
    pub created_at: String,
    pub status: String,
}

/// 文档切片（带来源信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub doc_id: String,
    pub doc_name: String,
    pub index: usize,
    pub text: String,
}

// ============================================================
// 存储管理
// ============================================================

/// 初始化存储目录
pub fn init_storage(data_dir: &Path) -> Result<(), String> {
    let docs_dir = data_dir.join("documents");
    let chunks_dir = data_dir.join("chunks");
    fs::create_dir_all(&docs_dir).map_err(|e| format!("创建文档目录失败: {}", e))?;
    fs::create_dir_all(&chunks_dir).map_err(|e| format!("创建切片目录失败: {}", e))?;

    // 如果没有配置文件，创建默认配置
    let config_path = data_dir.join("llm_config.json");
    if !config_path.exists() {
        let default_config = LlmConfig {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "".to_string(),
            model: "gpt-4o-mini".to_string(),
        };
        save_llm_config(data_dir, &default_config)?;
    }

    Ok(())
}

// ============================================================
// 文档类型与内容读取
// ============================================================

/// 根据文件名获取文档类型
pub fn get_doc_type(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".pdf") {
        "pdf".to_string()
    } else if lower.ends_with(".doc") || lower.ends_with(".docx") {
        "word".to_string()
    } else if lower.ends_with(".txt") {
        "txt".to_string()
    } else if lower.ends_with(".md") {
        "markdown".to_string()
    } else {
        "unknown".to_string()
    }
}

/// 读取文件内容为纯文本
pub fn read_file_content(path: &Path, doc_type: &str) -> Result<String, String> {
    match doc_type {
        "txt" | "markdown" => {
            fs::read_to_string(path).map_err(|e| format!("读取文本文件失败: {}", e))
        }
        "pdf" => {
            // PDF: 简单提取 - 读取二进制并过滤可打印字符
            // 生产环境应使用 pdf-extract 等库
            let bytes = fs::read(path).map_err(|e| format!("读取PDF失败: {}", e))?;
            Ok(extract_text_from_pdf(&bytes))
        }
        "word" => {
            // Word: 简单提取 - 读取二进制并过滤可打印字符
            let bytes = fs::read(path).map_err(|e| format!("读取Word文件失败: {}", e))?;
            Ok(extract_text_from_binary(&bytes))
        }
        _ => {
            // 未知类型，尝试以文本读取
            fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))
        }
    }
}

/// 从PDF字节中简单提取文本（过滤不可打印字符）
fn extract_text_from_pdf(bytes: &[u8]) -> String {
    let mut text = String::new();
    let mut in_text = false;

    for &b in bytes {
        if b == b'(' {
            in_text = true;
            continue;
        }
        if b == b')' {
            in_text = false;
            text.push(' ');
            continue;
        }
        if in_text && (b >= 0x20 && b < 0x7f || b >= 0x80) {
            text.push(b as char);
        }
    }

    if text.trim().is_empty() {
        // 回退: 提取所有可打印ASCII
        extract_text_from_binary(bytes)
    } else {
        text
    }
}

/// 从二进制中提取可打印文本
fn extract_text_from_binary(bytes: &[u8]) -> String {
    let mut text = String::new();
    let mut consecutive_printable = 0u32;
    let mut buffer = String::new();

    for &b in bytes {
        if b >= 0x20 && b < 0x7f || b == b'\n' || b == b'\r' || b == b'\t' || b >= 0x80 {
            buffer.push(b as char);
            consecutive_printable += 1;
        } else {
            if consecutive_printable > 10 {
                text.push_str(&buffer);
                text.push(' ');
            }
            buffer.clear();
            consecutive_printable = 0;
        }
    }
    if consecutive_printable > 10 {
        text.push_str(&buffer);
    }

    text
}

// ============================================================
// 文本切片
// ============================================================

/// 按字数分割文本（带重叠）
/// chunk_size: 每个切片的最大字数
/// overlap: 切片之间的重叠字数
pub fn split_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();

    if chars.is_empty() {
        return chunks;
    }

    let mut start = 0;
    while start < chars.len() {
        let end = std::cmp::min(start + chunk_size, chars.len());
        let chunk: String = chars[start..end].iter().collect();
        let trimmed = chunk.trim().to_string();
        if !trimmed.is_empty() {
            chunks.push(trimmed);
        }

        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(overlap);
        if start == 0 && end == chunk_size {
            // 防止无限循环
            start = end;
        }
    }

    chunks
}

// ============================================================
// 文档存储操作
// ============================================================

/// 保存文档元数据和切片
pub fn save_document(
    data_dir: &Path,
    meta: &DocumentMeta,
    chunks: &[String],
) -> Result<(), String> {
    let docs_dir = data_dir.join("documents");
    let chunks_dir = data_dir.join("chunks");

    // 保存元数据
    let meta_path = docs_dir.join(format!("{}.json", meta.id));
    let meta_json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("序列化文档元数据失败: {}", e))?;
    fs::write(&meta_path, meta_json).map_err(|e| format!("保存文档元数据失败: {}", e))?;

    // 保存切片
    let chunk_list: Vec<Chunk> = chunks
        .iter()
        .enumerate()
        .map(|(i, text)| Chunk {
            doc_id: meta.id.clone(),
            doc_name: meta.name.clone(),
            index: i,
            text: text.clone(),
        })
        .collect();

    let chunks_path = chunks_dir.join(format!("{}.json", meta.id));
    let chunks_json = serde_json::to_string_pretty(&chunk_list)
        .map_err(|e| format!("序列化切片失败: {}", e))?;
    fs::write(&chunks_path, chunks_json).map_err(|e| format!("保存切片失败: {}", e))?;

    Ok(())
}

/// 列出所有文档元数据
pub fn list_documents(data_dir: &Path) -> Result<Vec<DocumentMeta>, String> {
    let docs_dir = data_dir.join("documents");
    let mut docs = Vec::new();

    if !docs_dir.exists() {
        return Ok(docs);
    }

    let entries = fs::read_dir(&docs_dir).map_err(|e| format!("读取文档目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content =
                fs::read_to_string(&path).map_err(|e| format!("读取文档元数据失败: {}", e))?;
            let meta: DocumentMeta = serde_json::from_str(&content)
                .map_err(|e| format!("解析文档元数据失败: {}", e))?;
            docs.push(meta);
        }
    }

    // 按创建时间降序排列
    docs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(docs)
}

/// 删除文档
pub fn delete_document(data_dir: &Path, doc_id: &str) -> Result<(), String> {
    let meta_path = data_dir.join("documents").join(format!("{}.json", doc_id));
    let chunks_path = data_dir.join("chunks").join(format!("{}.json", doc_id));

    if meta_path.exists() {
        fs::remove_file(&meta_path).map_err(|e| format!("删除文档元数据失败: {}", e))?;
    }
    if chunks_path.exists() {
        fs::remove_file(&chunks_path).map_err(|e| format!("删除切片失败: {}", e))?;
    }

    Ok(())
}

/// 加载所有文档的所有切片
pub fn load_all_chunks(data_dir: &Path) -> Result<Vec<Chunk>, String> {
    let chunks_dir = data_dir.join("chunks");
    let mut all_chunks = Vec::new();

    if !chunks_dir.exists() {
        return Ok(all_chunks);
    }

    let entries = fs::read_dir(&chunks_dir).map_err(|e| format!("读取切片目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content =
                fs::read_to_string(&path).map_err(|e| format!("读取切片文件失败: {}", e))?;
            let chunks: Vec<Chunk> = serde_json::from_str(&content)
                .map_err(|e| format!("解析切片失败: {}", e))?;
            all_chunks.extend(chunks);
        }
    }

    Ok(all_chunks)
}

// ============================================================
// 关键词检索
// ============================================================

/// 关键词检索 - 基于词频匹配
/// 返回按相关性排序的Top-N切片及其分数
pub fn keyword_search(question: &str, chunks: &[Chunk], top_n: usize) -> Vec<(Chunk, f64)> {
    // 中文分词简化: 提取2-gram（适用于中文），以及按非字母数字分割（适用于英文）
    let query_chars: Vec<char> = question.chars().collect();
    let mut all_terms: Vec<String> = Vec::new();

    // 提取中文2-gram
    for i in 0..query_chars.len().saturating_sub(1) {
        let bigram: String = query_chars[i..i + 2].iter().collect();
        if bigram
            .chars()
            .all(|c| c.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&c))
        {
            all_terms.push(bigram);
        }
    }

    // 提取英文单词（按非字母数字分割）
    let english_terms: Vec<String> = question
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty() && s.len() > 1)
        .map(|s| s.to_string())
        .collect();
    all_terms.extend(english_terms);

    if all_terms.is_empty() {
        return vec![];
    }

    // 对每个切片计算匹配分数
    let mut scored: Vec<(Chunk, f64)> = chunks
        .iter()
        .map(|chunk| {
            let chunk_lower = chunk.text.to_lowercase();
            let mut score = 0.0f64;
            for term in &all_terms {
                let count = chunk_lower.matches(term.as_str()).count();
                score += count as f64;
            }
            // 归一化: 按切片长度归一化
            let len_factor = (chunk.text.len() as f64 / 500.0).max(1.0);
            (chunk.clone(), score / len_factor)
        })
        .filter(|(_, score)| *score > 0.0)
        .collect();

    // 按分数降序排列
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    scored.truncate(top_n);
    scored
}

// ============================================================
// LLM API调用
// ============================================================

/// OpenAI兼容API的请求体
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// OpenAI兼容API的响应体
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

/// 调用OpenAI兼容LLM API
pub async fn call_llm(config: &LlmConfig, question: &str, context: &str) -> Result<String, String> {
    if config.api_key.is_empty() {
        return Err("API Key未配置，请先在设置中配置LLM API Key".to_string());
    }

    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));

    let system_prompt = format!(
        "你是一个知识库问答助手。请根据以下检索到的文档内容回答用户的问题。\n\
         要求：\n\
         1. 只根据提供的文档内容回答，不要编造信息\n\
         2. 如果文档中没有相关信息，请明确说明\n\
         3. 回答时引用文档名称作为来源\n\n\
         检索到的文档内容:\n{}\n",
        context
    );

    let request = ChatRequest {
        model: config.model.clone(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
            },
            ChatMessage {
                role: "user".to_string(),
                content: question.to_string(),
            },
        ],
        temperature: 0.3,
        max_tokens: 2000,
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("请求LLM API失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM API返回错误 ({}): {}", status, body));
    }

    let chat_resp: ChatResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析LLM响应失败: {}", e))?;

    chat_resp
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "LLM返回空响应".to_string())
}

// ============================================================
// LLM配置管理
// ============================================================

/// 加载LLM配置
pub fn load_llm_config(data_dir: &Path) -> Result<LlmConfig, String> {
    let config_path = data_dir.join("llm_config.json");
    if !config_path.exists() {
        return Ok(LlmConfig {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "".to_string(),
            model: "gpt-4o-mini".to_string(),
        });
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("读取配置失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析配置失败: {}", e))
}

/// 保存LLM配置
pub fn save_llm_config(data_dir: &Path, config: &LlmConfig) -> Result<(), String> {
    let config_path = data_dir.join("llm_config.json");
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("保存配置失败: {}", e))?;
    Ok(())
}
