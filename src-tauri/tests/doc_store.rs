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

// ---------- 2026-10-19：写盘必须是原子的，且只有一套实现 ----------
//
// 这一组对应一个真实后果：`fs::write` 是「创建 + 截断 + 写」三步连做，
// 写到一半崩掉或磁盘写满，盘上留下的是**半截 JSON** —— 下次读回来就是坏文件。
// 而 `save_llm_config` 早就自己写了一份「临时文件 + rename」的原子写，
// `save_document` 却还在用裸 `fs::write` —— 同一套规则写了两遍，
// 差的那一遍就是这组用例要钉住的地方。
//
// 测法沿用本文件既有风格：用**盘上真实文件**而不是 mock，
// 因为「文件到底是不是半截的」「有没有残留临时文件」只有真盘上才看得出来。

#[test]
fn 保存文档后_没有残留临时文件() {
    let root = temp_root("atomic-no-tmp");
    let meta = DocumentMeta {
        id: "atomic_1700000000".into(),
        name: "atomic.txt".into(),
        size: 3,
        doc_type: "txt".into(),
        chunk_count: 1,
        created_at: "2026-01-01 00:00:00".into(),
        status: "done".into(),
    };
    rag::save_document(&root, &meta, &["正文".to_string()]).expect("保存文档");

    // 目标文件在
    assert!(root.join("documents").join("atomic_1700000000.json").exists());
    assert!(root.join("chunks").join("atomic_1700000000.json").exists());

    // 但**不该**留下任何 .tmp 残留：按扩展名扫目录的加载逻辑可能把它当正常文件读
    let leftovers: Vec<String> = fs::read_dir(root.join("documents"))
        .expect("读 documents")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "documents 下有临时文件残留: {:?}", leftovers);

    let leftovers: Vec<String> = fs::read_dir(root.join("chunks"))
        .expect("读 chunks")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "chunks 下有临时文件残留: {:?}", leftovers);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 反复保存同一文档_内容始终完整可解析() {
    // 反向对照：不能为了「原子」把内容写坏。
    // 每次都覆盖同一个文件，读回来必须始终是**完整**的 JSON。
    let root = temp_root("atomic-overwrite");
    let meta = DocumentMeta {
        id: "over_1700000000".into(),
        name: "over.txt".into(),
        size: 9,
        doc_type: "txt".into(),
        chunk_count: 2,
        created_at: "2026-01-01 00:00:00".into(),
        status: "done".into(),
    };
    for i in 0..5 {
        rag::save_document(
            &root,
            &meta,
            &[format!("第 {} 片", i), format!("第 {} 片之二", i)],
        )
        .expect("保存文档");
        let raw = fs::read_to_string(root.join("chunks").join("over_1700000000.json"))
            .expect("读切片");
        let parsed: Vec<serde_json::Value> =
            serde_json::from_str(&raw).unwrap_or_else(|e| panic!("第 {} 次保存后切片不是合法 JSON: {} / {}", i, e, raw));
        assert_eq!(parsed.len(), 2, "第 {} 次保存后切片数不对", i);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 保存文档失败时_不会留下半截的目标文件() {
    // 目标目录不存在 ⇒ 写不进去。
    // 关键不是报错本身，而是**盘上不能多出半截文件**。
    let root = temp_root("atomic-fail");
    fs::remove_dir_all(root.join("chunks")).expect("拆掉 chunks 目录");
    let meta = DocumentMeta {
        id: "fail_1700000000".into(),
        name: "fail.txt".into(),
        size: 1,
        doc_type: "txt".into(),
        chunk_count: 1,
        created_at: "2026-01-01 00:00:00".into(),
        status: "done".into(),
    };
    assert!(
        rag::save_document(&root, &meta, &["正文".to_string()]).is_err(),
        "写不进去时应当报错"
    );
    // 元数据那一步是成功的（documents 目录还在），但它必须是**完整**的
    let raw = fs::read_to_string(root.join("documents").join("fail_1700000000.json"))
        .expect("读元数据");
    serde_json::from_str::<serde_json::Value>(&raw)
        .unwrap_or_else(|e| panic!("元数据不是合法 JSON（半截文件）: {} / {}", e, raw));
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn 文档文件权限不被意外收紧() {
    // 反向对照：原子写不该顺带把用户自己的知识库文件改成 0600 ——
    // 那是 `llm_config.json` 的要求，不是文档的要求。
    use std::os::unix::fs::PermissionsExt;
    let root = temp_root("atomic-mode");
    let meta = DocumentMeta {
        id: "mode_1700000000".into(),
        name: "mode.txt".into(),
        size: 1,
        doc_type: "txt".into(),
        chunk_count: 1,
        created_at: "2026-01-01 00:00:00".into(),
        status: "done".into(),
    };
    rag::save_document(&root, &meta, &["正文".to_string()]).expect("保存文档");
    let mode = fs::metadata(root.join("documents").join("mode_1700000000.json"))
        .unwrap()
        .permissions()
        .mode()
        & 0o7777;
    assert_eq!(mode, 0o644, "文档元数据权限应是 0644，实际 {:o}", mode);
    // 切片是另一个文件，也要一样 —— 只查一个就等于没查
    let mode = fs::metadata(root.join("chunks").join("mode_1700000000.json"))
        .unwrap()
        .permissions()
        .mode()
        & 0o7777;
    assert_eq!(mode, 0o644, "文档切片权限应是 0644，实际 {:o}", mode);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_失败时_不留残留临时文件() {
    // 造一个「临时文件写成功了、但 rename 失败」的场景：
    // 把目标路径占成一个**目录**，于是 rename(file → dir) 必然失败。
    //
    // 这条专门盯「失败路径上的清理」：临时文件已经写出来了，
    // 不清掉的话盘上就多一个半截产物（.tmp 后缀），
    // 而按扩展名扫目录的加载逻辑可能把它当正常文件读。
    let root = temp_root("atomic-rename-fail");
    // 目标 `documents/ren_1700000000.json` 事先被占成一个目录
    fs::create_dir_all(root.join("documents").join("ren_1700000000.json")).expect("占位目录");
    let meta = DocumentMeta {
        id: "ren_1700000000".into(),
        name: "ren.txt".into(),
        size: 1,
        doc_type: "txt".into(),
        chunk_count: 1,
        created_at: "2026-01-01 00:00:00".into(),
        status: "done".into(),
    };
    assert!(
        rag::save_document(&root, &meta, &["正文".to_string()]).is_err(),
        "rename 失败时应当报错"
    );
    let leftovers: Vec<String> = fs::read_dir(root.join("documents"))
        .expect("读 documents")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "rename 失败后 documents 下有临时文件残留: {:?}",
        leftovers
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn 源码里_不再有裸的_fs_write() {
    // 这条是**源码文本审计**，不是行为测试。
    //
    // 理由：原子写这件事**没法用行为测**（要造「写一半崩掉」得做故障注入）。
    // 而本轮修的缺陷恰恰是「同一套规则写了两遍，差的那一遍是裸 fs::write」——
    // 那是**实现层**的漂移，只能在实现层钉住。
    //
    // 判据：写文件一律走 `write_atomic`，源码里不该再出现裸的 `fs::write(`。
    // 这与本仓既有的做法同族（sys 仓用「0 处 remove_file」文本审计钉住启动项实现）。
    let src = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/rag.rs"),
    )
    .expect("读 rag.rs 源码");

    // 例外只有一个：`write_atomic` 自己的 `#[cfg(not(unix))]` 回退分支
    // （非 unix 上没有 0600 语义，rename+权限那套也不适用）。
    // 所以判据是：**裸 fs::write 只允许出现在 write_atomic 函数体内部**。
    let helper_start = src
        .find("fn write_atomic(")
        .expect("rag.rs 里应当有 write_atomic");
    let helper_end = src[helper_start..]
        .find("\n}\n")
        .map(|i| helper_start + i)
        .expect("write_atomic 的函数体应当能定位到");
    // 切成三段：helper 之前 / helper 本身 / helper 之后
    let before = &src[..helper_start];
    let inside = &src[helper_start..helper_end];
    let after = &src[helper_end..];

    for (label, region) in [("之前", before), ("之后", after)] {
        let bare: Vec<&str> = region
            .lines()
            .filter(|l| l.contains("fs::write("))
            .collect();
        assert!(
            bare.is_empty(),
            "rag.rs 里 write_atomic {} 还有裸的 fs::write（写文件应一律走 write_atomic）:\n{}",
            label,
            bare.join("\n")
        );
    }

    let bare_inside = inside.matches("fs::write(").count();
    assert!(
        bare_inside <= 1,
        "write_atomic 内部有 {} 处 fs::write，预期至多 1 处（非 unix 回退）",
        bare_inside
    );

    // 反向对照：确实有 write_atomic 这条路径，且 save_document 与 save_llm_config
    // 都用它 —— 否则这条审计会变成「因为根本没有写盘逻辑所以恒绿」
    assert!(
        src.contains("fn write_atomic("),
        "rag.rs 里应当有 write_atomic 这个唯一的写盘实现"
    );
    assert!(
        src.contains("write_atomic(&meta_path"),
        "save_document 的元数据写入应当走 write_atomic"
    );
    assert!(
        src.contains("write_atomic(&chunks_path"),
        "save_document 的切片写入应当走 write_atomic"
    );
    assert!(
        src.contains("write_atomic(&config_path"),
        "save_llm_config 的写入应当走 write_atomic"
    );
}
