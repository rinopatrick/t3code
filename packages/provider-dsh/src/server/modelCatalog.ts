import { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

/**
 * Session model ids, exactly as the dsh ACP server advertises them in
 * session/new configOptions (probed live 2026-11-04). The JSON pair is the
 * id the agent accepts in set_config_option; the slug is the T3 display id.
 */
const DSH_DEFAULT_MODELS: ReadonlyArray<{ slug: string; name: string; sessionId: string }> = [
  {
    slug: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    sessionId: '["deepseek-account","deepseek-flash"]',
  },
  {
    slug: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    sessionId: '["deepseek-account","deepseek-v4-pro"]',
  },
];

export const DSH_SESSION_MODEL_IDS: ReadonlyMap<string, string> = new Map(
  DSH_DEFAULT_MODELS.map((model) => [model.slug, model.sessionId]),
);

export function dshModelCapabilities(): ModelCapabilities {
  return createModelCapabilities({ optionDescriptors: [] });
}

export const discoverDshModels = Effect.fn("discoverDshModels")(function* (_settings: DshSettings) {
  return DSH_DEFAULT_MODELS.map((model) => ({
    slug: model.slug,
    name: model.name,
    isCustom: false as const,
    capabilities: dshModelCapabilities(),
  }));
});
