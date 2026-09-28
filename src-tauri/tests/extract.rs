//! 入库文本提取的回归测试。
//!
//! 这里盯的是一条产品底线：取不出真文本时必须失败，不能把乱码切进知识库。
//! 检索质量无从补救入口的脏数据。

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

fn zip_of(entries: &[(&str, &str)]) -> Vec<u8> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default();
    for (name, body) in entries {
        w.start_file(*name, opts).unwrap();
        w.write_all(body.as_bytes()).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn write_temp(name: &str, bytes: &[u8]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("z-kb-extract-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

fn extract(path: &Path, doc_type: &str) -> Result<String, String> {
    z_biz_tool_kb_lib::rag::read_file_content(path, doc_type)
}

#[test]
fn docx_取正文并按段落换行() {
    let xml = "<w:body><w:p><w:r><w:t>知识库</w:t></w:r><w:r><w:t>入库</w:t></w:r></w:p>\
               <w:p><w:r><w:t>第二段落</w:t></w:r></w:p></w:body>";
    let path = write_temp("a.docx", &zip_of(&[("word/document.xml", xml)]));
    let text = extract(&path, "word").unwrap();
    assert!(text.contains("知识库入库"), "同段 run 应拼成一句: {text}");
    assert!(text.contains("第二段落"));
    assert!(text.find("入库").unwrap() < text.find("第二段落").unwrap());
}

#[test]
fn docx_解码实体并跳过属性里的尖括号() {
    let xml = "<w:p><w:r w:rsidR=\"00A\"><w:t>a &lt; b &amp;&amp; c &#8220;q&#8221;</w:t></w:r></w:p>";
    let path = write_temp("entity.docx", &zip_of(&[("word/document.xml", xml)]));
    let text = extract(&path, "word").unwrap();
    assert!(text.contains("a < b && c “q”"), "实体未解码: {text}");
    assert!(!text.contains("rsidR"), "标签属性被当成了正文: {text}");
}

#[test]
fn docx_缺正文条目要报错而不是静默空() {
    let path = write_temp("empty.docx", &zip_of(&[("docProps/core.xml", "<cp:core/>")]));
    let err = extract(&path, "word").unwrap_err();
    assert!(err.contains("document.xml") || err.contains("包"), "{err}");
}

#[test]
fn pptx_按幻灯片序号排_不按字典序() {
    let mut entries: Vec<(&str, String)> = Vec::new();
    for n in [2u32, 10, 1] {
        entries.push((
            Box::leak(format!("ppt/slides/slide{n}.xml").into_boxed_str()) as &str,
            format!("<a:p><a:r><a:t>SLIDE-{n}</a:t></a:r></a:p>"),
        ));
    }
    let refs: Vec<(&str, &str)> = entries.iter().map(|(n, b)| (*n, b.as_str())).collect();
    let path = write_temp("a.pptx", &zip_of(&refs));
    let text = extract(&path, "ppt").unwrap();
    let at = |s: &str| text.find(s).unwrap();
    assert!(at("SLIDE-1") < at("SLIDE-2") && at("SLIDE-2") < at("SLIDE-10"), "{text}");
    assert!(text.contains("[第 10 页]"), "页码前缀缺失: {text}");
}

#[test]
fn 纯图片型内容不产生垃圾_chunk() {
    // 一个不含任何 <w:t> 的 docx：以前会被切成乱码 chunk 存进去，现在必须拒绝
    let path = write_temp(
        "blank.docx",
        &zip_of(&[("word/document.xml", "<w:document><w:body/></w:document>")]),
    );
    let err = extract(&path, "word").unwrap_err();
    assert!(err.contains("没取出任何文本"), "{err}");
}

#[test]
fn 旧版_doc_明确让用户转_docx() {
    let path = write_temp("legacy.doc", b"\xd0\xcf\x11\xe0junkjunkjunk");
    let err = extract(&path, "word_legacy").unwrap_err();
    assert!(err.contains(".docx"), "{err}");
}

#[test]
fn 文本与markdown直读并剥字节序标记() {
    let path = write_temp("bom.md", &[[0xef, 0xbb, 0xbf].as_slice(), "# 标题\n正文".as_bytes()].concat());
    let text = extract(&path, "markdown").unwrap();
    assert_eq!(text, "# 标题\n正文");
}

#[test]
fn doc_type_分派覆盖上传入口支持的格式() {
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("X.PDF"), "pdf");
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("a.docx"), "word");
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("a.doc"), "word_legacy");
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("a.pptx"), "ppt");
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("a.md"), "markdown");
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("a.csv"), "txt");
    assert_eq!(z_biz_tool_kb_lib::rag::get_doc_type("a.xlsx"), "unknown");
}

/// 真实 PDF 冒烟：PDF 的文字层无法在测试里伪造得可信，所以拿本地文件验。
/// `KB_TEST_PDF=/path/to.pdf cargo test` 才跑，默认跳过以免绑死某台机器。
///
/// 这里断言的不是"一定能读出来"，而是**任何一份真实 PDF 都不能把 panic 传出来**：
/// 本地那份中文 PDF 用的正是 pdf-extract 不支持的 GBK-EUC-H，之前直接 panic。
#[test]
fn 真实_pdf_要么取出文字要么给出可读错误_绝不panic() {
    let Some(p) = std::env::var("KB_TEST_PDF").ok() else {
        eprintln!("skip: 未设置 KB_TEST_PDF");
        return;
    };
    let result = std::panic::catch_unwind(|| extract(Path::new(&p), "pdf"));
    match result {
        Ok(Ok(text)) => {
            assert!(text.chars().count() > 50, "文字层太短: {text}");
            assert!(!text.contains('\u{0}'), "取出了控制字符，说明是二进制垃圾");
        }
        Ok(Err(err)) => {
            assert!(err.contains("PDF"), "{err}");
            assert!(err.contains("导出") || err.contains("OCR"), "错误没给出下一步: {err}");
        }
        Err(_) => panic!("提取真实 PDF 时 panic 了：入库线程会被一次上传打崩"),
    }
}

/// 扫描件没有文字层 —— 必须报「需要先 OCR」，而不是索引一个空文档
#[test]
fn 无文字层的_pdf_报扫描件() {
    let path = write_temp("fake.pdf", b"%PDF-1.4\nnot a real document\n%%EOF\n");
    let err = extract(&path, "pdf").unwrap_err();
    assert!(err.contains("PDF"), "{err}");
}
