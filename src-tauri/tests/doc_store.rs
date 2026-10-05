//! 文档存储的**安全**与**容错**回归测试。
//!
//! 这两组断言都不是"顺手补的覆盖率"，每一条都对应一个真实后果：
//!
//! - 路径穿越那条，`doc_id` 来自前端 IPC。删文档的落点是
//!   `data_dir/documents/{doc_id}.json`，`../` 拼出去就是**数据目录之外**的文件，
//!   而动作是 `remove_file` —— 也就是任意 `.json` 文件删除。
//! - 容错那几条，一份文件坏掉就把整条命令打成 Err，用户侧看到的是
//!   「知识库整体不可用」，而他能做的只有回去手动删文件重来。
//!
//! 测法上刻意用**盘上真实文件**而不是 mock：穿越的危害恰恰发生在
//! 「路径真的解析到目录外」这一步，mock 掉 `remove_file` 就测不到了。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use z_biz_tool_kb_lib::rag::{self, DocumentMeta, LlmConfig};

/// 每次调用给一个独立目录。测试之间不共享状态，失败时也不会互相污染。
fn temp_root(tag: &str) -> PathBuf {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let n = SEQ.fetch_add(1, Ordering::SeqCst);
    let p = std::env::temp_dir().join(format!(
        "kb-doc-store-{}-{}-{}",
        tag,
        std::process::id(),
        n
    ));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(p.join("documents")).expect("建 documents");
    fs::create_dir_all(p.join("chunks")).expect("建 chunks");
    p
}

fn meta_json(id: &str, created_at: &str) -> String {
    serde_json::json!({
        "id": id,
        "name": format!("{}.txt", id),
        "size": 12,
        "doc_type": "txt",
        "chunk_count": 1,
        "created_at": created_at,
        "status": "done",
    })
    .to_string()
}

fn write_doc(root: &Path, id: &str, created_at: &str) {
    fs::write(
        root.join("documents").join(format!("{}.json", id)),
        meta_json(id, created_at),
    )
    .expect("写元数据");
    fs::write(
        root.join("chunks").join(format!("{}.json", id)),
        serde_json::json!([{
            "doc_id": id,
            "doc_name": format!("{}.txt", id),
            "index": 0,
            "text": "正文",
        }])
        .to_string(),
    )
    .expect("写切片");
}

fn write_raw_chunks(root: &Path, id: &str, body: &str) {
    fs::write(root.join("chunks").join(format!("{}.json", id)), body).expect("写切片");
}

// ---------- P0-1 路径穿越 ----------

#[test]
fn 删除文档时_带路径分隔符的_id_被拒() {
    let root = temp_root("traversal-sep");
    // 受害者：数据目录**外面**的一个真实 .json 文件
    let victim = root.parent().unwrap().join(format!(
        "kb-victim-{}.json",
        std::process::id()
    ));
    fs::write(&victim, "{}").expect("造受害文件");

    let evil = format!(
        "../{}",
        victim
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .trim_end_matches(".json")
    );
    let err = rag::delete_document(&root, &evil).expect_err("必须被拒");
    assert!(
        err.contains("非法字符"),
        "应报非法字符，实际: {}",
        err
    );
    assert!(
        victim.exists(),
        "数据目录外的文件被删了 —— 路径穿越没挡住"
    );
    let _ = fs::remove_file(&victim);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 删除文档时_多层上跳的_id_被拒() {
    let root = temp_root("traversal-deep");
    // `..` 逐层上跳，无论层数多少都不该被接受
    for evil in [
        "../../../etc/passwd",
        "..",
        "a/../../b",
        "a/b",
        "/etc/passwd",
        "",
    ] {
        assert!(
            rag::delete_document(&root, evil).is_err(),
            "doc_id={:?} 本该被拒，却通过了",
            evil
        );
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 删除文档时_合法的_id_照常删掉() {
    // 反向对照：白名单不能把正常功能一起挡掉。
    // 没有这条，一个「一律拒绝」的判据也能让上面两条测试变绿。
    let root = temp_root("traversal-ok");
    write_doc(&root, "readme_1700000000", "2026-01-01 00:00:00");

    rag::delete_document(&root, "readme_1700000000").expect("合法 id 应可删");
    assert!(!root.join("documents").join("readme_1700000000.json").exists());
    assert!(!root.join("chunks").join("readme_1700000000.json").exists());
    let _ = fs::remove_dir_all(&root);
}

// ---------- P0-5 单文件损坏不再拖垮整体 ----------

#[test]
fn 一份元数据损坏_列表照常返回其余文档() {
    let root = temp_root("list-tolerate");
    write_doc(&root, "good-a_1", "2026-01-02 00:00:00");
    write_doc(&root, "good-b_2", "2026-01-01 00:00:00");
    // 半截 JSON：模拟写入过程中断电 / 外部手改
    fs::write(
        root.join("documents").join("broken_3.json"),
        "{\"id\": \"broken\", \"na",
    )
    .expect("造坏文件");

    let docs = rag::list_documents(&root).expect("不该整条失败");
    let ids: Vec<&str> = docs.iter().map(|d: &DocumentMeta| d.id.as_str()).collect();
    assert_eq!(ids, vec!["good-a_1", "good-b_2"], "应只剩两份好文档");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 一份切片损坏_检索数据照常加载() {
    let root = temp_root("chunks-tolerate");
    write_raw_chunks(
        &root,
        "good_1",
        &serde_json::json!([{
            "doc_id": "good", "doc_name": "g.txt", "index": 0, "text": "可检索正文"
        }])
        .to_string(),
    );
    fs::write(root.join("chunks").join("broken_2.json"), "not json at all")
        .expect("造坏切片");

    let chunks = rag::load_all_chunks(&root).expect("不该整条失败");
    assert_eq!(chunks.len(), 1, "应仍能取到那份好切片");
    assert_eq!(chunks[0].doc_id, "good");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 目录本身读不到时_仍然要报错() {
    // 反向对照：容错不能滑成「什么都返回空」。
    // 目录不存在是「还没初始化」，与「文件损坏」是两回事，不能一起吞掉。
    let missing = std::env::temp_dir().join("kb-does-not-exist-xyzzy");
    let _ = fs::remove_dir_all(&missing);
    assert!(!missing.exists());
    assert_eq!(rag::list_documents(&missing).unwrap().len(), 0);
    assert_eq!(rag::load_all_chunks(&missing).unwrap().len(), 0);
}

// ---------- P0-4 明文 key 的落盘权限 ----------

#[cfg(unix)]
#[test]
fn 配置文件以_0600_落盘() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp_root("perms");
    let cfg = LlmConfig {
        base_url: "https://api.openai.com/v1".into(),
        api_key: "sk-this-is-a-real-looking-secret".into(),
        model: "gpt-4o-mini".into(),
    };
    rag::save_llm_config(&root, &cfg).expect("保存配置");

    let p = root.join("llm_config.json");
    let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, 0o600, "明文 key 文件权限应是 0600，实际 {:o}", mode);

    // 反向对照：内容仍要能读回来，别为了收紧权限把功能弄坏
    let back = rag::load_llm_config(&root).expect("读回配置");
    assert_eq!(back.api_key, cfg.api_key);
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn 旧的_0644_配置文件_读的时候被收紧() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp_root("perms-legacy");
    let p = root.join("llm_config.json");
    fs::write(
        &p,
        serde_json::json!({
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-legacy",
            "model": "gpt-4o-mini"
        })
        .to_string(),
    )
    .unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();

    rag::load_llm_config(&root).expect("读配置");
    let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, 0o600, "旧文件读一次就应收紧到 0600，实际 {:o}", mode);
    let _ = fs::remove_dir_all(&root);
}
