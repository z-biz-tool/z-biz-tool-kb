//! 文档详情（只读预览）的回归测试。
//!
//! 这个命令是给「文档卡片点击」用的：卡片原来只有 cursor:pointer 没有任何行为，
//! 现在必须真的打开一份详情。由此带来的两条硬约束：
//!
//! - doc_id 来自前端 IPC，读取路径同样可能被 `../` 逃出数据目录
//!   —— 删除有白名单，读取不能因为「只是读」就漏掉。
//! - 预览是截断的，但 `total_chunks` 必须是盘上真实数量，
//!   不能让截断后的条数冒充全量。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use z_biz_tool_kb_lib::rag::{self, DocumentMeta};

fn temp_root(tag: &str) -> PathBuf {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let n = SEQ.fetch_add(1, Ordering::SeqCst);
    let p = std::env::temp_dir().join(format!(
        "kb-doc-detail-{}-{}-{}",
        tag,
        std::process::id(),
        n
    ));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(p.join("documents")).expect("建 documents");
    fs::create_dir_all(p.join("chunks")).expect("建 chunks");
    p
}

fn meta(id: &str, chunk_count: usize) -> DocumentMeta {
    DocumentMeta {
        id: id.to_string(),
        name: format!("{id}.txt"),
        size: 1024,
        doc_type: "txt".to_string(),
        chunk_count,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        status: "ready".to_string(),
    }
}

#[test]
fn 详情返回元数据与前_n_个切片() {
    let root = temp_root("limit");
    let texts: Vec<String> = (0..30).map(|i| format!("第 {i} 片内容")).collect();
    rag::save_document(&root, &meta("doc_1700000000", 30), &texts).expect("保存文档");

    let detail = rag::load_document_detail(&root, "doc_1700000000", 5, 600).expect("读取详情");

    assert_eq!(detail.meta.name, "doc_1700000000.txt");
    assert_eq!(detail.total_chunks, 30, "total_chunks 必须是盘上真实数量");
    assert_eq!(detail.chunks.len(), 5, "只应返回前 5 个切片");
    assert!(detail.truncated, "还有 25 个没展示，必须标记截断");
    assert_eq!(detail.chunks[0].index, 0);
    assert_eq!(detail.chunks[4].index, 4);
    assert!(detail.chunks[4].text.contains("第 4 片"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 切片数不超过上限时不标记截断() {
    let root = temp_root("no-truncate");
    let texts: Vec<String> = (0..3).map(|i| format!("第 {i} 片")).collect();
    rag::save_document(&root, &meta("small_1700000000", 3), &texts).expect("保存文档");

    let detail = rag::load_document_detail(&root, "small_1700000000", 20, 600).expect("读取详情");
    assert_eq!(detail.total_chunks, 3);
    assert_eq!(detail.chunks.len(), 3);
    assert!(!detail.truncated);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 切片预览按字符截断而不是字节() {
    // 中文一个字 3 字节：按字节切会落到 UTF-8 中间直接 panic
    let root = temp_root("chars");
    let long = "汉".repeat(1000);
    rag::save_document(&root, &meta("cjk_1700000000", 1), &[long]).expect("保存文档");

    let detail = rag::load_document_detail(&root, "cjk_1700000000", 20, 10).expect("读取详情");
    let preview = &detail.chunks[0].text;
    assert_eq!(preview.chars().count(), 11, "10 个字符 + 一个省略号");
    assert!(preview.ends_with('…'));
    assert_eq!(&preview[..preview.len() - '…'.len_utf8()], "汉".repeat(10));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 截断函数在边界上不补省略号() {
    assert_eq!(rag::truncate_preview("12345", 5), "12345");
    assert_eq!(rag::truncate_preview("123456", 5), "12345…");
    assert_eq!(rag::truncate_preview("abc", 0), "");
    assert_eq!(rag::truncate_preview("中文", 10), "中文");
    assert_eq!(rag::truncate_preview("", 10), "");
}

#[test]
fn 详情读取同样拒绝路径穿越() {
    let root = temp_root("traversal");
    // 数据目录外放一个可读的 json，若校验漏了，详情能把它读出来
    let victim = root
        .parent()
        .unwrap()
        .join(format!("kb-detail-victim-{}.json", std::process::id()));
    fs::write(&victim, "{\"secret\":true}").expect("造受害文件");
    let escaped = format!(
        "../{}",
        victim
            .file_stem()
            .unwrap()
            .to_str()
            .expect("受害文件名应是 UTF-8")
    );

    for evil in [escaped.as_str(), "../../../etc/passwd", "a/b", "..", ""] {
        let err = rag::load_document_detail(&root, evil, 20, 600)
            .expect_err(&format!("doc_id={evil:?} 本该被拒"));
        assert!(
            err.contains("非法字符") || err.contains("为空"),
            "应报 id 非法，实际: {err}"
        );
    }

    let _ = fs::remove_file(&victim);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 文档不存在时给出可读错误而不是空详情() {
    let root = temp_root("missing");
    let err = rag::load_document_detail(&root, "missing_1700000000", 20, 600)
        .expect_err("不存在的文档不该返回空详情");
    assert!(err.contains("不存在"), "应说明文档不存在，实际: {err}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 切片文件损坏时详情报错而不是假装没有内容() {
    let root = temp_root("corrupt");
    rag::save_document(&root, &meta("bad_1700000000", 1), &["正文".to_string()]).expect("保存文档");
    fs::write(root.join("chunks").join("bad_1700000000.json"), "not json").expect("写坏切片");

    let err = rag::load_document_detail(&root, "bad_1700000000", 20, 600)
        .expect_err("切片损坏不能被当成空内容");
    assert!(err.contains("切片损坏"), "应指出切片损坏，实际: {err}");

    let _ = fs::remove_dir_all(&root);
}
