//! 检索质量的回归测试。
//!
//! 排序错了比检索报错更坏：错的那几条切片会连同引用一起端给 LLM，
//! 答案看起来自信、来源却不相干，用户无从分辨。所以这里的断言都是"谁排第一"。

use std::path::PathBuf;
use z_biz_tool_kb_lib::rag::{self, Chunk};

fn chunk(doc_id: &str, idx: usize, text: &str) -> Chunk {
    Chunk {
        doc_id: doc_id.to_string(),
        doc_name: format!("{doc_id}.txt"),
        index: idx,
        text: text.to_string(),
    }
}

fn top_docs(results: &[(Chunk, f64)]) -> Vec<&str> {
    results.iter().map(|(c, _)| c.doc_id.as_str()).collect()
}

#[test]
fn 稀有词压过每篇都有的泛词() {
    // 「安装」三篇都有（泛词），只有 doc-b 提到 aTrust —— 问 aTrust 时 b 必须第一
    let chunks = vec![
        chunk("doc-a", 0, "安装步骤说明，安装前请关闭防火墙，安装过程约五分钟"),
        chunk("doc-b", 1, "aTrust 的安装证书位于配置目录，首次启动 aTrust 需要管理员授权"),
        chunk("doc-c", 2, "安装完成后安装日志在临时目录，反复安装会留下多个安装记录"),
    ];
    let hits = rag::bm25_search("aTrust 怎么安装", &chunks, 3);
    assert!(!hits.is_empty(), "有明确命中时不该返回空");
    assert_eq!(top_docs(&hits)[0], "doc-b", "泛词淹没排序：{:?}", hits);
    let b = hits.iter().find(|(c, _)| c.doc_id == "doc-b").unwrap().1;
    let others = hits
        .iter()
        .filter(|(c, _)| c.doc_id != "doc-b")
        .fold(0.0f64, |a, (_, s)| a.max(*s));
    assert!(b > others, "稀有词没有把相关切片顶上去: b={b} others={others}");
}

#[test]
fn 长度归一按词数而不是字节数() {
    // 旧实现拿 text.len()（字节）除以 500 做长度归一，一个汉字 3 字节 ——
    // 中文切片凭空再吃约 3 倍惩罚，长文更是被压到几乎不出现在证据里。
    // 现在按 token 数归一：词频相同、只有长度差时，短的排前面但分差有界（BM25 饱和）。
    let filler = "说明文字内容";
    let short = format!("{filler}证书轮换");
    let long = format!("{}证书轮换", filler.repeat(60));
    let chunks = vec![chunk("short", 0, &short), chunk("long", 1, &long)];
    let hits = rag::bm25_search("证书", &chunks, 2);
    assert_eq!(hits.len(), 2, "两篇都含「证书」，都该出现在证据里");
    assert_eq!(top_docs(&hits)[0], "short", "长度归一没生效: {:?}", hits);
    let ratio = hits[0].1 / hits[1].1;
    assert!(
        ratio < 3.0,
        "20 倍长度差被过度惩罚（旧的字节归一会给出约 60 倍分差）: {ratio}"
    );
}

#[test]
fn 一个字的问题也能命中() {
    let chunks = vec![chunk("d", 0, "网关证书与密钥轮换流程")];
    let hits = rag::bm25_search("证", &chunks, 3);
    assert_eq!(hits.len(), 1, "单字查询被丢掉了（需要一元 gram）");
}

#[test]
fn 跨标点的垃圾_gram_不产生() {
    let terms = rag::tokenize("安装 aTrust 之后");
    assert!(!terms.contains(&"装a".to_string()), "{terms:?}");
    assert!(!terms.contains(&"t之".to_string()), "{terms:?}");
    assert!(terms.contains(&"安装".to_string()));
    assert!(terms.contains(&"atrust".to_string()), "大写词没被归一: {terms:?}");
    assert!(terms.contains(&"之后".to_string()));
}

#[test]
fn 无命中与空库都返回空而不是猜() {
    let chunks = vec![chunk("d", 0, "完全无关的内容")];
    assert!(rag::bm25_search("量子隧穿", &chunks, 5).is_empty());
    assert!(rag::bm25_search("任意", &[], 5).is_empty());
    assert!(rag::bm25_search("!!! ???", &chunks, 5).is_empty());
}

#[test]
fn 同分切片按稳定次序给出不随机器变化的证据() {
    let chunks = vec![
        chunk("same", 2, "证书 证书"),
        chunk("same", 0, "证书 证书"),
        chunk("same", 1, "证书 证书"),
    ];
    let hits = rag::bm25_search("证书", &chunks, 3);
    let idx: Vec<usize> = hits.iter().map(|(c, _)| c.index).collect();
    assert_eq!(idx, vec![0, 1, 2], "同分时的次序必须确定: {idx:?}");
}

fn temp_dir(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("z-kb-{}-{}", tag, std::process::id()))
}

fn meta(id: &str) -> rag::DocumentMeta {
    rag::DocumentMeta {
        id: id.to_string(),
        name: format!("{id}.txt"),
        size: 128,
        doc_type: "txt".to_string(),
        chunk_count: 1,
        created_at: String::new(),
        status: "ok".to_string(),
    }
}

#[test]
fn 磁盘知识库检索会随上传删除而失效重建() {
    let dir = temp_dir("corpus");
    let _ = std::fs::remove_dir_all(&dir);
    rag::init_storage(&dir).expect("初始化存储目录");

    let put = |id: &str, text: &str| {
        rag::save_document(&dir, &meta(id), &[text.to_string()]).expect("写入切片")
    };
    put("root", "根证书导出到 pem 文件");
    let (hits, size) = rag::search_corpus(&dir, "根证书怎么导出", 5).unwrap();
    assert_eq!(size, 1);
    assert_eq!(top_docs(&hits), vec!["root"]);

    put("proxy", "代理配置说明");
    let (hits, size) = rag::search_corpus(&dir, "根证书怎么导出", 5).unwrap();
    assert_eq!(size, 2, "新增文档后缓存没失效");
    assert_eq!(top_docs(&hits), vec!["root"], "加了无关文档后正确的那篇仍该第一");

    rag::delete_document(&dir, "root").unwrap();
    let (hits, size) = rag::search_corpus(&dir, "根证书怎么导出", 5).unwrap();
    assert_eq!(size, 1);
    assert!(hits.is_empty(), "被删掉的文档还出现在证据里");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn 长文档里靠后的切片也能被检索到() {
    let dir = temp_dir("deep");
    std::fs::remove_dir_all(&dir).ok();
    rag::init_storage(&dir).unwrap();
    // 一份长文档切成 20 个切片，只有最后一个提到端口
    let texts: Vec<String> = (0..20)
        .map(|i| format!("第 {} 节，讲述客户端的通用行为与界面说明", i))
        .collect();
    let mut texts = texts;
    texts[19] = "第 19 节，中继服务默认监听 9443 端口".to_string();
    let m = rag::DocumentMeta {
        chunk_count: texts.len(),
        ..meta("long")
    };
    rag::save_document(&dir, &m, &texts).unwrap();
    let (hits, _) = rag::search_corpus(&dir, "9443 端口", 5).unwrap();
    assert_eq!(hits[0].0.index, 19, "命中了错误的切片: {:?}", top_docs(&hits));
    std::fs::remove_dir_all(&dir).ok();
}
