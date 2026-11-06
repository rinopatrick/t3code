import type { ModelCapabilities } from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import { buildSelectOptionDescriptor } from "@t3tools/provider-core/server/snapshotProbe";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

/**
 * Session model ids, exactly as the dsh ACP server advertises them in
 * session/new configOptions. The JSON pair is the id the agent accepts
 * in set_config_option; the slug is the T3 display id.
 */
const DSH_DEFAULT_MODELS: ReadonlyArray<{ slug: string; name: string; sessionId: string }> = [
  {
    slug: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    sessionId: '["deepseek-account","deepseek-flash"]',
  },
  {
    slug: "deepseek-v4-flash-official",
    name: "DeepSeek V4 Flash (Official API)",
    sessionId: '["deepseek-official","deepseek-v4-flash"]',
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

/** Matches the live session/new reasoning_effort select; applied by the ACP option loop. */
const DSH_REASONING_EFFORT_ID = "reasoning_effort";

export function dshModelCapabilities(): ModelCapabilities {
  return createModelCapabilities({
    optionDescriptors: [
      {
        ...buildSelectOptionDescriptor({
          id: DSH_REASONING_EFFORT_ID,
          label: "Reasoning effort",
          options: [
            { value: "off", label: "Off" },
            { value: "low", label: "Low" },
            { value: "high", label: "High", isDefault: true },
            { value: "max", label: "Max" },
          ],
        }),
        role: "reasoning" as const,
      },
    ],
  });
}

export const discoverDshModels = Effect.fn("discoverDshModels")(function* (_settings: DshSettings) {
  return DSH_DEFAULT_MODELS.map((model) => ({
    slug: model.slug,
    name: model.name,
    isCustom: false as const,
    capabilities: dshModelCapabilities(),
  }));
});
