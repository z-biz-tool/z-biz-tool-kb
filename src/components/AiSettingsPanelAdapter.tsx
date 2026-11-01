/**
 * 统一 AI 配置面板的本仓适配层（照抄 terminal / file 样板）。
 *
 * 本仓历史特点：原来的设置表单**强制要求 API Key**（`required: true`），
 * 而后端私网地址免密钥 —— 用户指向本地网关时被前端拦住，后端的
 * 免密钥逻辑永远走不到。共享面板的 `draftNeedsApiKey` 判据与 Rust
 * `needs_api_key()` 同源，这个分裂在这里一并消失。
 */

import { invoke } from "@tauri-apps/api/core";
import {
  AiSettingsPanel,
  type AiConfigDraft,
  type AiSettingsActions,
  type AiSettingsPanelProps,
  type LlmFailure,
  type PresetView,
} from "z-biz-tool-shared/ai/settings";

/** 本仓后端的草稿形状（`llm_shared.rs::AiConfigDraft`）。 */
interface KbAiConfigDraft {
  provider: string;
  base_url: string;
  model: string;
  api_key: string;
  temperature: number | null;
  max_tokens: number | null;
}

function draftToConfig(draft: AiConfigDraft): KbAiConfigDraft {
  return {
    provider: draft.preset,
    base_url: draft.baseUrl,
    model: draft.model,
    api_key: draft.apiKey,
    temperature: draft.temperature ?? null,
    max_tokens: draft.maxTokens ?? null,
  };
}

/** 后端失败 → 共享面板的失败结构。字段名一致，直接透传。 */
function toPanelFailure(raw: unknown): LlmFailure {
  const f = (raw ?? {}) as Partial<LlmFailure> & {
    error?: string;
    message?: string;
  };
  return {
    kind: f.kind ?? "unknown",
    status: f.status ?? null,
    message: f.message ?? f.error ?? "未知错误",
    hint: f.hint ?? "",
    focus: (f.focus as LlmFailure["focus"]) ?? "none",
  };
}

export function createAiSettingsActions(): AiSettingsActions {
  return {
    async listPresets(): Promise<PresetView[]> {
      const list = await invoke<PresetView[]>("list_llm_presets");
      return Array.isArray(list) ? list : [];
    },

    async listModels(draft: AiConfigDraft): Promise<string[]> {
      try {
        const models = await invoke<string[]>("list_llm_models", {
          overrideConfig: draftToConfig(draft),
        });
        return Array.isArray(models) ? models : [];
      } catch (e) {
        throw toPanelFailure(e);
      }
    },

    async testConnection(draft: AiConfigDraft) {
      try {
        const detail = await invoke<string>("test_ai_config", {
          overrideConfig: draftToConfig(draft),
        });
        return { ok: true, detail };
      } catch (e) {
        return { ok: false, failure: toPanelFailure(e) };
      }
    },

    async save(draft: AiConfigDraft): Promise<boolean> {
      await invoke("save_ai_config", { config: draftToConfig(draft) });
      return true;
    },
  };
}

/** 后端脱敏视图（`llm_shared.rs::AiConfigView`）。 */
export interface KbAiConfigView {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  apiKey: string;
  hasApiKey: boolean;
}

export function loadAiConfigView(): Promise<KbAiConfigView> {
  return invoke<KbAiConfigView>("get_ai_config");
}

/** 本仓的 AI 配置面板（直接复用共享面板）。 */
export function KbAiSettingsPanel({
  view,
  onSaved,
}: {
  view: KbAiConfigView | null;
  onSaved?: () => void;
}) {
  const props: AiSettingsPanelProps = {
    value: view
      ? {
          preset: view.provider,
          baseUrl: view.baseUrl,
          model: view.model,
          temperature: view.temperature ?? undefined,
          maxTokens: view.maxTokens ?? undefined,
        }
      : undefined,
    hasApiKey: view?.hasApiKey === true,
    actions: createAiSettingsActions(),
    onSaved,
  };
  return <AiSettingsPanel {...props} />;
}
