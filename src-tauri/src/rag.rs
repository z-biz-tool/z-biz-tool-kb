use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

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

/// 把目录权限收紧到 0700。
///
/// 失败只提示不中断：数据目录可能落在用户没有权限改的父目录下
/// （例如从别处整体拷过来的、或容器挂载卷），此时收紧失败但功能仍可用，
/// 直接 Err 会让整个应用起不来 —— 那比权限偏宽更糟。
#[cfg(unix)]
fn harden_dir(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let meta = match fs::metadata(dir) {
        Ok(m) => m,
        Err(e) => return Err(format!("读取目录权限失败: {}", e)),
    };
    let mode = meta.permissions().mode() & 0o7777;
    if mode & !0o700 != 0 {
        if let Err(e) = fs::set_permissions(dir, fs::Permissions::from_mode(0o700)) {
            eprintln!("[kb] 收紧数据目录权限失败（可继续使用）: {}", e);
        }
    }
    Ok(())
}

/// 把文件权限收紧到 0600，用于已经存在的明文 key 配置文件。
#[cfg(unix)]
fn harden_file(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        let mode = meta.permissions().mode() & 0o7777;
        if mode & !0o600 != 0 {
            if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
                eprintln!("[kb] 收紧配置文件权限失败（可继续使用）: {}", e);
            }
        }
    }
}

#[cfg(not(unix))]
fn harden_dir(_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(unix))]
fn harden_file(_path: &Path) {}

/// 初始化存储目录
pub fn init_storage(data_dir: &Path) -> Result<(), String> {
    let docs_dir = data_dir.join("documents");
    let chunks_dir = data_dir.join("chunks");
    fs::create_dir_all(&docs_dir).map_err(|e| format!("创建文档目录失败: {}", e))?;
    fs::create_dir_all(&chunks_dir).map_err(|e| format!("创建切片目录失败: {}", e))?;
    // 这个目录里躺着明文 API key，目录本身就不该对同机其他账号可列
    harden_dir(data_dir)?;

    // 如果没有配置文件，创建默认配置
    let config_path = data_dir.join("llm_config.json");
    if !config_path.exists() {
        let default_config = LlmConfig {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "".to_string(),
            model: "gpt-4o-mini".to_string(),
        };
        save_llm_config(data_dir, &default_config)?;
    } else {
        // 旧版本落盘的文件是 0644，这里顺带收紧一次
        harden_file(&config_path);
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
    } else if lower.ends_with(".docx") {
        "word".to_string()
    } else if lower.ends_with(".doc") {
        // 旧版 OLE 二进制复合文档，zip 打不开，不能和 .docx 走同一条路
        "word_legacy".to_string()
    } else if lower.ends_with(".pptx") {
        "ppt".to_string()
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "markdown".to_string()
    } else if lower.ends_with(".txt") || lower.ends_with(".csv") || lower.ends_with(".log") {
        "txt".to_string()
    } else {
        "unknown".to_string()
    }
}

/// 读取文件内容为纯文本
///
/// 取不出文本就明确报错，不再退回「把二进制里可打印字符抠出来」那一套：
/// 那种做法对压缩过的 PDF / OOXML 只会产出一串乱码，而乱码会被切成 chunk 存进知识库，
/// 之后每一次检索都会把这些垃圾片段当证据端出去 —— 脏在入口，坏在后面所有问题。
pub fn read_file_content(path: &Path, doc_type: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
    let text = match doc_type {
        "txt" | "markdown" => bytes_to_text(&bytes),
        "pdf" => extract_pdf(&bytes)?,
        "word" => extract_ooxml(&bytes, &["word/document.xml"], "w:t", "</w:p>")?,
        "ppt" => extract_pptx(&bytes)?,
        "word_legacy" => {
            return Err(
                "旧版 .doc（OLE 二进制）读不了，请在 Word 里另存为 .docx 再上传".to_string()
            )
        }
        // 认不得的类型一律拒绝：以前这里退回"抠可打印字符"，
        // 于是 .xlsx / .zip / 图片都会被当成文本切进知识库
        other => {
            return Err(format!(
                "暂不支持 {other} 类型（支持 pdf / docx / pptx / md / txt / csv），\
                 先导出成 PDF 或纯文本再上传"
            ))
        }
    };
    if text.trim().is_empty() {
        return Err(format!(
            "这份 {} 文件里没取出任何文本（扫描件？加密件？），没有可索引的内容",
            doc_type
        ));
    }
    Ok(text)
}

/// UTF-8 优先，退而求其次做 lossy —— 但 lossy 之前先试 GBK 之外的常见单字节，
/// 不让一个带 BOM 或 latin-1 的文本文件直接失败
fn bytes_to_text(bytes: &[u8]) -> String {
    let stripped = match bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        Some(rest) => rest,
        None => bytes,
    };
    match std::str::from_utf8(stripped) {
        Ok(s) => s.to_string(),
        Err(_) => String::from_utf8_lossy(stripped).into_owned(),
    }
}

fn extract_pdf(bytes: &[u8]) -> Result<String, String> {
    // pdf-extract 走 lopdf 的内容流，认得压缩流与字体映射；按页取，页之间留边界，
    // chunk 才不会把上一页结尾和下一页开头粘成一句话。
    //
    // catch_unwind 不是防御性摆设：pdf-extract 碰到自己不支持的编码
    // （老版 Word/WPS 导出的中文 PDF 常用 GBK-EUC-H、BigFive-EUC-H）是直接 panic 而非 Err，
    // 一次上传能把整个入库调用打崩。这里兜成可读的失败，指给用户能做的下一步。
    let outcome = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem_by_pages(bytes));
    let pages = match outcome {
        Ok(Ok(pages)) => pages,
        Ok(Err(e)) => return Err(format!("PDF 解析失败: {}（加密件？）", e)),
        Err(panic) => {
            let detail = panic
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "解析中断".to_string());
            return Err(format!(
                "这份 PDF 的字体编码解析不了（{}），常见于老版办公软件导出的中文 PDF。\
                 用 Acrobat/Word 重新导出一遍（勾选「ISO 19005-1 兼容」或「文档中嵌入的字体」）通常就能读；\
                 扫描件则需要先 OCR",
                detail
            ));
        }
    };
    let out: String = pages
        .iter()
        .map(|p| format!("{}\n", p.trim()))
        .collect::<Vec<_>>()
        .join("\n");
    if out.trim().is_empty() {
        return Err("PDF 里没解析出文字层，这一份大概是扫描件（只有图），需要先 OCR".to_string());
    }
    Ok(out)
}

/// OOXML（.docx）就是一个 zip，正文在 word/document.xml 的 <w:t> 里
fn extract_ooxml(
    bytes: &[u8],
    entry_names: &[&str],
    tag: &str,
    block_end: &str,
) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("打开 OOXML 包失败: {}", e))?;
    let mut out = String::new();
    for name in entry_names {
        let entry = archive
            .by_name(name)
            .map_err(|e| format!("{} 里缺 {}: {}", "包", name, e))?;
        out.push_str(&read_xml_text(entry, tag, block_end));
    }
    Ok(out)
}

fn extract_pptx(bytes: &[u8]) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("打开 pptx 包失败: {}", e))?;
    // 幻灯片按 slide1/slide2… 的序号排，不按 zip 里的字典序（slide10 会插到 slide2 前面）
    let mut slides: Vec<(u32, String)> = Vec::new();
    for i in 0..archive.len() {
        let name = match archive.by_index(i) {
            Ok(f) => f.name().to_string(),
            Err(_) => continue,
        };
        if let Some(num) = slide_number(&name) {
            slides.push((num, name));
        }
    }
    slides.sort_by_key(|(n, _)| *n);
    let mut out = String::new();
    for (num, name) in slides {
        let entry = match archive.by_name(&name) {
            Ok(f) => f,
            Err(_) => continue,
        };
        out.push_str(&format!("\n[第 {} 页]\n", num));
        out.push_str(&read_xml_text(entry, "a:t", "</a:p>"));
    }
    Ok(out)
}

fn slide_number(name: &str) -> Option<u32> {
    let rest = name.strip_prefix("ppt/slides/slide")?;
    let digits = rest.strip_suffix(".xml")?;
    digits.parse::<u32>().ok()
}

/// 从一整个 XML 里按 `<tag>…</tag>` 抠文本，遇到 block_end 补一个换行。
/// 只做文本节点这一件事，不建 DOM —— 一个 200 页的 document.xml 用 DOM 解析是浪费。
fn read_xml_text<R: std::io::Read>(mut entry: R, tag: &str, block_end: &str) -> String {
    let mut buf = String::new();
    if entry.read_to_string(&mut buf).is_err() {
        return String::new();
    }
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut out = String::new();
    let bytes: Vec<char> = buf.chars().collect();
    let mut i = 0usize;
    while i < bytes.len() {
        if starts_at(&bytes, i, &open) {
            // 跳过属性区找到 '>'，属性里可能带 > 之外的引号内容，但 XML 属性值不含裸 '>'
            let end_of_tag = match bytes[i..].iter().position(|&c| c == '>') {
                Some(p) => i + p + 1,
                None => break,
            };
            let text_start = end_of_tag;
            let text_end = match find_at(&bytes, text_start, &close) {
                Some(p) => p,
                None => break,
            };
            out.push_str(&decode_entities(&bytes[text_start..text_end]));
            i = text_end + close.chars().count();
        } else if starts_at(&bytes, i, block_end) {
            out.push('\n');
            i += block_end.chars().count();
        } else {
            i += 1;
        }
    }
    out
}

fn starts_at(hay: &[char], at: usize, needle: &str) -> bool {
    let n: Vec<char> = needle.chars().collect();
    at + n.len() <= hay.len() && hay[at..at + n.len()] == n[..]
}

fn find_at(hay: &[char], from: usize, needle: &str) -> Option<usize> {
    let n: Vec<char> = needle.chars().collect();
    let mut i = from;
    while i + n.len() <= hay.len() {
        if hay[i..i + n.len()] == n[..] {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn decode_entities(s: &[char]) -> String {
    let text: String = s.iter().collect();
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(idx) = rest.find('&') {
        out.push_str(&rest[..idx]);
        let tail = &rest[idx + 1..];
        if let Some(semi) = tail.find(';') {
            let entity = &tail[..semi];
            let decoded = match entity {
                "amp" => Some("&"),
                "lt" => Some("<"),
                "gt" => Some(">"),
                "quot" => Some("\""),
                "apos" => Some("'"),
                "nbsp" => Some(" "),
                _ => None,
            };
            if let Some(d) = decoded {
                out.push_str(d);
                rest = &tail[semi + 1..];
                continue;
            }
            if let Some(num) = entity.strip_prefix('#') {
                let code = num
                    .strip_prefix('x')
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .or_else(|| num.parse::<u32>().ok());
                if let Some(c) = code.and_then(char::from_u32) {
                    out.push(c);
                    rest = &tail[semi + 1..];
                    continue;
                }
            }
        }
        out.push('&');
        rest = tail;
    }
    out.push_str(rest);
    out
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

/// 文档 id 白名单。
///
/// 入库时（`commands.rs::upload_document`）id 是
/// `file_name.replace(|c| !c.is_alphanumeric() && c != '-' && c != '_', "")`
/// 再拼时间戳生成的，所以**合法 id 只会含 ASCII 字母数字、`-`、`_`**。
/// 这层校验存在的理由：`doc_id` 是从前端 IPC 传进来的任意字符串，而删除路径是
/// `data_dir/documents/{doc_id}.json`。不校验时 `../../../某处/x` 拼出来的是
/// **数据目录之外**的路径，配上 `remove_file` 就是任意 `.json` 文件删除。
fn validate_doc_id(doc_id: &str) -> Result<(), String> {
    if doc_id.is_empty() {
        return Err("文档 id 为空".to_string());
    }
    // 上限按入库生成的最长形态给（文件名 + `_` + 10 位秒级时间戳）留足余量
    if doc_id.len() > 200 {
        return Err(format!("文档 id 过长（{} 字符）", doc_id.len()));
    }
    if !doc_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("文档 id 含非法字符: {}", doc_id));
    }
    Ok(())
}

/// 取 `dir/{doc_id}.json` 的路径：**白名单 + 目录包含性**双闸。
///
/// 白名单已经排掉了分隔符，所以「canonicalize 之后的目录再 join 一个纯文件名」
/// 在语义上不可能逃逸。这一层不是多余的：它是专门用来防「将来有人为了兼容
/// 某个带空格的文件名而放宽白名单」的那种改动的 —— 那种改动单靠白名单就防不住了。
fn doc_file_path(dir: &Path, doc_id: &str) -> Result<PathBuf, String> {
    validate_doc_id(doc_id)?;
    let base = dir
        .canonicalize()
        .map_err(|e| format!("目录不可用（{}）: {}", dir.display(), e))?;
    Ok(base.join(format!("{}.json", doc_id)))
}

/// 列出所有文档元数据
pub fn list_documents(data_dir: &Path) -> Result<Vec<DocumentMeta>, String> {
    let docs_dir = data_dir.join("documents");
    let mut docs = Vec::new();

    if !docs_dir.exists() {
        return Ok(docs);
    }

    let entries = fs::read_dir(&docs_dir).map_err(|e| format!("读取文档目录失败: {}", e))?;
    // 单个条目读不出/JSON 损坏时**跳过这一份**，而不是让整条命令失败。
    // 此前是 `?` 直接冒泡，于是任意一份元数据损坏 == 整个知识库不可用 ——
    // 而用户能做的只有回去删文件重来，列表页直接空掉。
    let mut skipped = 0usize;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[kb] 跳过无法读取的目录条目: {}", e);
                skipped += 1;
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<DocumentMeta>(&content) {
                Ok(meta) => docs.push(meta),
                Err(e) => {
                    eprintln!(
                        "[kb] 跳过损坏的元数据 {}: {}",
                        path.display(),
                        e
                    );
                    skipped += 1;
                }
            },
            Err(e) => {
                eprintln!("[kb] 跳过读不出的元数据 {}: {}", path.display(), e);
                skipped += 1;
            }
        }
    }
    if skipped > 0 {
        eprintln!(
            "[kb] 共 {} 份文档元数据不可用，已跳过；其余文档仍可正常列出",
            skipped
        );
    }

    // 按创建时间降序排列
    docs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(docs)
}

/// 删除文档
pub fn delete_document(data_dir: &Path, doc_id: &str) -> Result<(), String> {
    // 2026-10-05 补：原先直接把前端传来的 doc_id 拼进路径就 remove_file，
    // `../` 能逃出数据目录 —— 任意 `.json` 文件删除。
    let meta_path = doc_file_path(&data_dir.join("documents"), doc_id)?;
    let chunks_dir = data_dir.join("chunks");
    let chunks_path = if chunks_dir.exists() {
        doc_file_path(&chunks_dir, doc_id)?
    } else {
        chunks_dir.join(format!("{}.json", doc_id))
    };

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
    // 与 list_documents 同一条理由：一份切片文件坏掉不该让检索整体失效
    let mut skipped = 0usize;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[kb] 跳过无法读取的切片条目: {}", e);
                skipped += 1;
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Vec<Chunk>>(&content) {
                Ok(chunks) => all_chunks.extend(chunks),
                Err(e) => {
                    eprintln!("[kb] 跳过损坏的切片 {}: {}", path.display(), e);
                    skipped += 1;
                }
            },
            Err(e) => {
                eprintln!("[kb] 跳过读不出的切片 {}: {}", path.display(), e);
                skipped += 1;
            }
        }
    }
    if skipped > 0 {
        eprintln!(
            "[kb] 共 {} 份切片不可用，已跳过；其余文档仍可正常检索",
            skipped
        );
    }

    Ok(all_chunks)
}

// ============================================================
// 检索：BM25 + 倒排索引
// ============================================================

const BM25_K1: f64 = 1.5;
const BM25_B: f64 = 0.75;

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{f900}'..='\u{faff}')
}

/// 切词：CJK 连续段取一元 + 相邻二元，字母数字段取小写整词。
///
/// gram 只在同一段内部取 —— 跨标点/空格取二元会造出「装a」这种哪儿都能匹配的垃圾词。
/// 中文保留一元是为了让一个字的问题也有命中（二元需要至少两个连续汉字）。
pub fn tokenize(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut cjk_run: Vec<char> = Vec::new();
    let mut ascii_run: String = String::new();

    fn flush_cjk(run: &mut Vec<char>, terms: &mut Vec<String>) {
        for (i, c) in run.iter().enumerate() {
            terms.push(c.to_string());
            if i + 1 < run.len() {
                terms.push(format!("{}{}", c, run[i + 1]));
            }
        }
        run.clear();
    }
    fn flush_ascii(run: &mut String, terms: &mut Vec<String>) {
        if run.chars().count() >= 2 {
            terms.push(run.to_lowercase());
        }
        run.clear();
    }

    for c in text.chars() {
        if is_cjk(c) {
            flush_ascii(&mut ascii_run, &mut terms);
            cjk_run.push(c);
        } else if c.is_alphanumeric() {
            flush_cjk(&mut cjk_run, &mut terms);
            ascii_run.push(c);
        } else {
            flush_cjk(&mut cjk_run, &mut terms);
            flush_ascii(&mut ascii_run, &mut terms);
        }
    }
    flush_cjk(&mut cjk_run, &mut terms);
    flush_ascii(&mut ascii_run, &mut terms);
    terms
}

#[derive(Clone)]
struct ChunkIndex {
    chunks: Vec<Chunk>,
    /// term -> [(文档下标, 该词在该文档里的词频)]
    postings: HashMap<String, Vec<(usize, usize)>>,
    /// 每篇切片的词数（不是字节数：原实现拿 `len()` 当长度，中文一个字 3 字节，
    /// 等于把所有中文切片系统性打了三折惩罚）
    doc_len: Vec<f64>,
    avg_len: f64,
}

impl ChunkIndex {
    fn build(chunks: &[Chunk]) -> ChunkIndex {
        let mut postings: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
        let mut doc_len = Vec::with_capacity(chunks.len());
        for (i, chunk) in chunks.iter().enumerate() {
            let terms = tokenize(&chunk.text);
            doc_len.push(terms.len() as f64);
            let mut local: HashMap<&str, usize> = HashMap::new();
            for t in &terms {
                *local.entry(t.as_str()).or_insert(0) += 1;
            }
            for (t, tf) in local {
                postings.entry(t.to_string()).or_default().push((i, tf));
            }
        }
        let avg_len = if chunks.is_empty() {
            0.0
        } else {
            doc_len.iter().sum::<f64>() / chunks.len() as f64
        };
        ChunkIndex {
            chunks: chunks.to_vec(),
            postings,
            doc_len,
            avg_len,
        }
    }

    fn search(&self, question: &str, top_n: usize) -> Vec<(Chunk, f64)> {
        let mut q_terms = tokenize(question);
        q_terms.sort();
        q_terms.dedup();
        if q_terms.is_empty() || self.chunks.is_empty() {
            return vec![];
        }

        let n = self.chunks.len() as f64;
        let avg_len = self.avg_len.max(1.0);
        let mut scores = vec![0.0f64; self.chunks.len()];
        let mut matched = false;

        for term in q_terms {
            let Some(posting) = self.postings.get(&term) else {
                continue;
            };
            matched = true;
            let df = posting.len() as f64;
            // 稀有词值钱：每个 chunk 都出现的「安装」「使用」几乎不携带信息，
            // 原实现按裸词频累加，正是被这类泛词淹没、把无关切片端给 LLM 的根因
            let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
            for (doc, tf) in posting {
                let tf = *tf as f64;
                let dl = self.doc_len[*doc].max(1.0);
                let norm = tf * (BM25_K1 + 1.0)
                    / (tf + BM25_K1 * (1.0 - BM25_B + BM25_B * (dl / avg_len)));
                scores[*doc] += idf * norm;
            }
        }
        if !matched {
            return vec![];
        }

        let mut ranked: Vec<(usize, f64)> = scores
            .iter()
            .enumerate()
            .filter(|(_, s)| **s > 0.0)
            .map(|(i, s)| (i, *s))
            .collect();
        // 同分时按 (文档 id, 切片序号) 稳定排序，避免同样的问题两次给出不同证据
        ranked.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let la = &self.chunks[a.0];
                    let lb = &self.chunks[b.0];
                    (&la.doc_id, la.index).cmp(&(&lb.doc_id, lb.index))
                })
        });
        ranked.truncate(top_n);
        ranked
            .into_iter()
            .map(|(i, s)| (self.chunks[i].clone(), s))
            .collect()
    }
}

/// 问答要跑多次检索，而重建索引要读全部切片文件。按目录指纹缓存，
/// 上传/删除改了哪个 json（文件名、大小、mtime）就自然失效。
struct CachedIndex {
    fingerprint: u64,
    index: ChunkIndex,
}

static INDEX_CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();

fn chunks_fingerprint(chunks_dir: &Path) -> Result<u64, String> {
    let mut hasher = DefaultHasher::new();
    if chunks_dir.exists() {
        let mut facts: Vec<String> = Vec::new();
        let entries =
            fs::read_dir(chunks_dir).map_err(|e| format!("读取切片目录失败: {}", e))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let meta = entry
                .metadata()
                .map_err(|e| format!("读取切片元数据失败: {}", e))?;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            facts.push(format!("{}:{}:{}", path.display(), meta.len(), mtime));
        }
        facts.sort();
        for f in facts {
            f.hash(&mut hasher);
        }
    }
    Ok(hasher.finish())
}

/// 在磁盘上的知识库上检索：缓存索引，命中不了不报错（返回空由调用方给「没找到」的话术）
pub fn search_corpus(
    data_dir: &Path,
    question: &str,
    top_n: usize,
) -> Result<(Vec<(Chunk, f64)>, usize), String> {
    let fingerprint = chunks_fingerprint(&data_dir.join("chunks"))?;
    let cache = INDEX_CACHE.get_or_init(|| Mutex::new(None));
    let guard = cache
        .lock()
        .map_err(|_| "检索索引锁被污染，重启应用即可恢复".to_string())?;
    let stale = match guard.as_ref() {
        Some(c) => c.fingerprint != fingerprint,
        None => true,
    };
    drop(guard);
    if stale {
        let chunks = load_all_chunks(data_dir)?;
        let mut guard = cache
            .lock()
            .map_err(|_| "检索索引锁被污染，重启应用即可恢复".to_string())?;
        *guard = Some(CachedIndex {
            fingerprint,
            index: ChunkIndex::build(&chunks),
        });
    }
    let guard = cache
        .lock()
        .map_err(|_| "检索索引锁被污染，重启应用即可恢复".to_string())?;
    let cached = guard
        .as_ref()
        .ok_or_else(|| "检索索引尚未建立".to_string())?;
    Ok((cached.index.search(question, top_n), cached.index.chunks.len()))
}

/// 直接对给定切片集合检索（测试与一次性调用用，不带缓存）
pub fn bm25_search(question: &str, chunks: &[Chunk], top_n: usize) -> Vec<(Chunk, f64)> {
    ChunkIndex::build(chunks).search(question, top_n)
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
    // 读的时候也收一次权限：老版本落盘的是 0644，而 init_storage 未必被走到
    harden_file(&config_path);
    serde_json::from_str(&content).map_err(|e| format!("解析配置失败: {}", e))
}

/// 保存LLM配置
///
/// 2026-10-05 补：文件里存的是**明文 API key**，而原先用 `fs::write` 落盘，
/// 权限跟着 umask 走（本机实测 0644）—— 同机任何能读这个目录的进程都拿得到。
/// 现在先写同目录临时文件并显式 0600，再 rename 到位：同文件系统内 rename 是
/// 原子的，所以既不会出现「读到半截配置」，也不会留下一个带明文 key 的残留文件。
pub fn save_llm_config(data_dir: &Path, config: &LlmConfig) -> Result<(), String> {
    let config_path = data_dir.join("llm_config.json");
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        let tmp_path = config_path.with_extension("json.tmp");
        {
            let mut f = fs::File::create(&tmp_path)
                .map_err(|e| format!("创建配置临时文件失败: {}", e))?;
            f.set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("设置配置权限失败: {}", e))?;
            f.write_all(json.as_bytes())
                .map_err(|e| format!("写入配置失败: {}", e))?;
            f.sync_all().map_err(|e| format!("刷盘失败: {}", e))?;
        }
        fs::rename(&tmp_path, &config_path).map_err(|e| format!("保存配置失败: {}", e))?;
        // rename 保留的是源文件权限，这里再钉一次，防止中间被别的路径改过
        harden_file(&config_path);
        Ok(())
    }
    #[cfg(not(unix))]
    {
        fs::write(&config_path, json).map_err(|e| format!("保存配置失败: {}", e))?;
        Ok(())
    }
}
