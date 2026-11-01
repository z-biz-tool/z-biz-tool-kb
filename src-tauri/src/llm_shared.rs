//! 统一 AI 配置的接入胶水（kb 仓）。
//!
//! 与 terminal 样板同一结构，本仓差异只有一点：**模型名与地址之外，
//! 本仓还依赖「私网免密钥」判据放行本地网关** —— 该判据在 cap-llm
//! 里（`LlmConfig::needs_api_key`），协议层接入后自动获得。
//!
//! ## 命令名对齐（家族基准）
//!
//! | 命令 | 作用 |
//! |---|---|
//! | `get_ai_config` | 读配置（**脱敏视图**：apiKey 恒空串，hasApiKey 表达有无） |
//! | `save_ai_config` | 写配置（apiKey 空串 = 继承已保存的密钥） |
//! | `list_llm_presets` | 供应商预设目录 |
//! | `list_llm_models` | 列模型（草稿覆盖） |
//! | `test_ai_config` | 连通性探测（草稿覆盖） |
//!
//! 本仓原来的 `get_llm_config` 会把**明文 api_key 整份回传前端**（前端还
//! 回填进表单）—— 那是全家族最严重的一处密钥泄露面，此改造一并拔掉。

use serde::{Deserialize, Serialize};

use cap_llm_config::{
    migrate_legacy_configs, shared_secret_store, LlmConfigFile, LlmSecret, StoreError,
};

/// 本仓对外的 AI 配置形状（脱敏视图）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    /// 预设 id（cap-llm 的 preset id），空串表示自定义服务。
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    /// 恒为空串。
    pub api_key: String,
    /// 是否已保存密钥。
    pub has_api_key: bool,
}

/// 草稿配置（前端设置表单送来的形状）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigDraft {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

fn err_msg(e: StoreError) -> String {
    e.to_string()
}

/// 统一落点配置 → cap-llm 配置。
///
/// kb 的问答固定温度 0.3、max_tokens 2000（RAG 摘要场景不需要发散）；
/// 统一落点里没配时用这两个默认值。
pub fn to_cap(cfg: &LlmConfigFile, api_key: &str) -> Result<cap_llm::LlmConfig, String> {
    let provider = if cfg.preset.is_empty() {
        cfg.provider.as_str()
    } else {
        cfg.preset.as_str()
    };
    let (kind, preset) =
        cap_llm::ProviderKind::parse_with_preset(provider).map_err(|e| e.to_string())?;
    Ok(cap_llm::LlmConfig {
        kind,
        base_url: cfg.base_url.clone(),
        api_key: api_key.to_string(),
        model: cfg.model.clone(),
        timeout: std::time::Duration::from_millis(cfg.timeout_ms.unwrap_or(60_000).max(1_000)),
        temperature: Some(cfg.temperature.unwrap_or(0.3)),
        max_tokens: Some(cfg.max_tokens.unwrap_or(2_000)),
        preset,
    })
}

/// 读统一配置（脱敏视图）。
pub fn read_shared_config() -> Result<AiConfigView, String> {
    let cfg = cap_llm_config::load_config().map_err(err_msg)?;
    let Some(cfg) = cfg else {
        return Ok(AiConfigView {
            provider: String::new(),
            base_url: String::new(),
            model: String::new(),
            temperature: None,
            max_tokens: None,
            api_key: String::new(),
            has_api_key: false,
        });
    };

    let has_api_key = shared_secret_store()
        .get()
        .map_err(err_msg)?
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);

    Ok(AiConfigView {
        provider: if cfg.preset.is_empty() {
            cfg.provider.clone()
        } else {
            cfg.preset.clone()
        },
        base_url: cfg.base_url.clone(),
        model: cfg.model.clone(),
        temperature: cfg.temperature.map(|t| t as f64),
        max_tokens: cfg.max_tokens,
        api_key: String::new(),
        has_api_key,
    })
}

/// 读统一配置 + 明文密钥（**仅供后端发请求用**，绝不回传前端）。
pub fn read_shared_config_with_key() -> Result<(LlmConfigFile, String), String> {
    let cfg = cap_llm_config::load_config()
        .map_err(err_msg)?
        .ok_or_else(|| "尚未配置 AI 服务商".to_string())?;
    let key = shared_secret_store()
        .get()
        .map_err(err_msg)?
        .unwrap_or_default();
    Ok((cfg, key))
}

/// 写统一配置。`api_key` 为空串 ⇒ 继承已保存的密钥。
pub fn write_shared_config(
    provider: &str,
    base_url: &str,
    model: &str,
    api_key: &str,
) -> Result<(), String> {
    let store = shared_secret_store();

    // 保留统一落点里已有的 temperature / max_tokens（本仓面板不编辑它们）
    let saved = cap_llm_config::load_config()
        .map_err(err_msg)?
        .unwrap_or_default();
    let file = LlmConfigFile {
        preset: provider.to_string(),
        provider: provider.to_string(),
        base_url: base_url.to_string(),
        model: model.to_string(),
        temperature: saved.temperature,
        max_tokens: saved.max_tokens,
        timeout_ms: saved.timeout_ms,
        updated_at_ms: now_ms(),
    };
    cap_llm_config::save_config(&file).map_err(err_msg)?;

    if !api_key.trim().is_empty() {
        store.set(api_key).map_err(err_msg)?;
    }
    Ok(())
}

/// 迁移一次历史配置（幂等）。
///
/// 本仓旧落点 `app_data_dir()/llm_config.json` 的三平台路径已登记在
/// `cap_llm_config::migrate_legacy_configs`（bundle id 是
/// `com.zifang.z-biz-tool-kb`，与迁移器的 site 匹配）。迁移时明文密钥
/// 搬进 OS 密钥库，旧文件里的密钥字段被抹掉。
pub fn migrate_legacy() -> Result<Option<String>, String> {
    let report = migrate_legacy_configs().map_err(err_msg)?;
    Ok(if report.migrated { report.from } else { None })
}

fn now_ms() -> Option<u64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

// ==================== Tauri 命令 ====================

/// 读 AI 配置（脱敏视图）。
#[tauri::command]
pub fn get_ai_config() -> Result<AiConfigView, String> {
    read_shared_config()
}

/// 保存 AI 配置（密钥进 OS 密钥库）。
#[tauri::command]
pub fn save_ai_config(config: AiConfigDraft) -> Result<(), String> {
    write_shared_config(
        &config.provider,
        &config.base_url,
        &config.model,
        &config.api_key,
    )
}

/// 草稿 → cap 配置；草稿没填的项从统一落点继承。
fn build_cap_for_draft(draft: Option<AiConfigDraft>) -> Result<cap_llm::LlmConfig, String> {
    let draft = draft.unwrap_or_default();
    let has_draft_key = !draft.api_key.trim().is_empty();
    let has_any_draft = has_draft_key
        || !draft.provider.trim().is_empty()
        || !draft.base_url.trim().is_empty()
        || !draft.model.trim().is_empty();
    if !has_any_draft {
        let (cfg, key) = read_shared_config_with_key()?;
        return to_cap(&cfg, &key);
    }
    let mut file = LlmConfigFile {
        preset: draft.provider.clone(),
        provider: draft.provider.clone(),
        base_url: draft.base_url.clone(),
        model: draft.model.clone(),
        temperature: draft.temperature.map(|t| t as f32),
        max_tokens: draft.max_tokens,
        timeout_ms: None,
        updated_at_ms: None,
    };
    if let Ok(Some(saved)) = cap_llm_config::load_config() {
        if file.preset.is_empty() && file.provider.is_empty() {
            file.preset = saved.preset.clone();
            file.provider = saved.provider.clone();
        }
        if file.base_url.trim().is_empty() {
            file.base_url = saved.base_url.clone();
        }
        if file.model.trim().is_empty() {
            file.model = saved.model.clone();
        }
        if file.temperature.is_none() {
            file.temperature = saved.temperature;
        }
        if file.max_tokens.is_none() {
            file.max_tokens = saved.max_tokens;
        }
    }
    let key = if has_draft_key {
        draft.api_key
    } else {
        shared_secret_store()
            .get()
            .map_err(err_msg)?
            .unwrap_or_default()
    };
    to_cap(&file, &key)
}

/// 测试 AI 配置（草稿覆盖：填完 Key 不用先保存就能测试）。
#[tauri::command]
pub async fn test_ai_config(
    override_config: Option<AiConfigDraft>,
) -> Result<String, cap_llm::LlmFailure> {
    let cap = build_cap_for_draft(override_config).map_err(cap_llm::LlmFailure::from)?;
    let elapsed = cap_llm::ping(&cap)
        .await
        .map_err(cap_llm::LlmFailure::from_error)?;
    Ok(format!(
        "连接成功（{} · {}），耗时 {}ms",
        cap.kind.label(),
        cap.model,
        elapsed.as_millis()
    ))
}

/// 给界面的预设视图。
#[derive(Debug, Serialize)]
pub struct PresetView {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    pub category: &'static str,
    pub category_label: &'static str,
    pub requires_api_key: bool,
    pub aliases: &'static [&'static str],
    pub verified_on: &'static str,
}

fn category_key(c: cap_llm::preset::Category) -> &'static str {
    use cap_llm::preset::Category as C;
    match c {
        C::International => "international",
        C::Domestic => "domestic",
        C::Aggregator => "aggregator",
        C::SelfHosted => "selfHosted",
    }
}

/// 列出可选的供应商预设（单一事实源在 `cap-llm::presets`）。
#[tauri::command]
pub fn list_llm_presets() -> Vec<PresetView> {
    cap_llm::preset::PRESETS
        .iter()
        .map(|p| PresetView {
            id: p.id,
            label: p.label,
            base_url: p.base_url,
            category: category_key(p.category),
            category_label: p.category.label(),
            requires_api_key: p.requires_api_key,
            aliases: p.aliases,
            verified_on: p.verified_on,
        })
        .collect()
}

/// 列出该配置可用的模型（草稿覆盖）。
#[tauri::command]
pub async fn list_llm_models(
    override_config: Option<AiConfigDraft>,
) -> Result<Vec<String>, cap_llm::LlmFailure> {
    let cap = build_cap_for_draft(override_config).map_err(cap_llm::LlmFailure::from)?;
    let models = cap_llm::list_models(&cap)
        .await
        .map_err(cap_llm::LlmFailure::from_error)?;
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 环境变量是进程级的，所有碰统一落点的测试串行。
    static LLM_ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock_llm_env() -> std::sync::MutexGuard<'static, ()> {
        LLM_ENV_GUARD
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn get_ai_config_never_returns_the_plaintext_key() {
        let _guard = lock_llm_env();
        let _iso = cap_llm_config::testing::IsolatedLlm::new("kb-view");
        // 本仓旧命令曾把明文 key 整份回传前端 —— 这是全家族最严重的一处
        // 密钥泄露面，这条测试钉死它不再发生。
        write_shared_config(
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-chat",
            "sk-secret-kb",
        )
        .expect("保存应成功");

        let view = read_shared_config().expect("读取应成功");
        assert_eq!(view.api_key, "", "明文密钥绝不能回传前端");
        assert!(view.has_api_key, "有密钥要用布尔表达");
    }

    #[test]
    fn saved_config_file_on_disk_has_no_api_key_field() {
        let _guard = lock_llm_env();
        let _iso = cap_llm_config::testing::IsolatedLlm::new("kb-disk");
        write_shared_config("deepseek", "", "deepseek-chat", "sk-secret-kb-disk")
            .expect("保存应成功");

        let path = cap_llm_config::config_path().expect("应能取到路径");
        let content = std::fs::read_to_string(&path).expect("配置文件应存在");
        assert!(!content.contains("sk-secret-kb-disk"), "密钥明文落盘了！");
        assert!(!content.to_lowercase().contains("apikey"));
    }

    #[test]
    fn save_with_empty_api_key_keeps_the_saved_key() {
        let _guard = lock_llm_env();
        let _iso = cap_llm_config::testing::IsolatedLlm::new("kb-inherit");
        write_shared_config("deepseek", "", "deepseek-chat", "sk-first").expect("首次保存");
        write_shared_config("deepseek", "", "deepseek-reasoner", "").expect("二次保存");

        let (_, key) = read_shared_config_with_key().expect("应能读到");
        assert_eq!(key, "sk-first", "空串密钥应继承，而不是清除");
    }

    #[test]
    fn rag_defaults_fill_in_when_the_shared_config_has_none() {
        // kb 的问答固定低温低上限；统一落点没配时应有默认值而不是 None
        let cfg = LlmConfigFile {
            preset: "deepseek".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            model: "deepseek-chat".into(),
            ..Default::default()
        };
        let cap = to_cap(&cfg, "sk-x").expect("转换应成功");
        assert_eq!(cap.temperature, Some(0.3), "RAG 场景默认温度 0.3");
        assert_eq!(cap.max_tokens, Some(2_000), "RAG 场景默认上限 2000");
    }
}
