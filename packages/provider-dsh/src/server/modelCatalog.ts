import { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

const DSH_DEFAULT_MODELS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { slug: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

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
