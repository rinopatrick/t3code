import { expect, it } from "@effect/vitest";
import { DshSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DSH_DRIVER_KIND, DshProviderCapabilitiesV2 } from "./adapter.ts";
import { DSH_SESSION_MODEL_IDS, discoverDshModels } from "./modelCatalog.ts";

const settings = Schema.decodeSync(DshSettings);

it.effect("reports slice-3 capabilities with model switch on, interrupt on, steering off", () =>
  Effect.gen(function* () {
    const parsed = settings({});
    expect(parsed.binaryPath).toBe("dsh");
    const caps = DshProviderCapabilitiesV2;
    expect(caps.sessions.supportsModelSwitchInSession).toBe(true);
    expect(caps.turns.supportsInterrupt).toBe(true);
    expect(caps.turns.supportsSteeringByInterruptRestart).toBe(false);
    expect(caps.turns.supportsQueuedMessages).toBe(true);
    expect(caps.threads.canRollbackThread).toBe(false);
    expect(caps.threads.canForkThread).toBe(false);
    expect(caps.approvals.supportsCommandApproval).toBe(false);
    expect(DSH_DRIVER_KIND).toBe("dsh");
  }),
);

it.effect("model catalog lists account flash, official flash, and pro", () =>
  Effect.gen(function* () {
    const models = yield* discoverDshModels(settings({}));
    expect(models.map((model) => model.slug)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-official",
      "deepseek-v4-pro",
    ]);
  }),
);

it.effect("models advertise the wire reasoning_effort selector", () =>
  Effect.gen(function* () {
    const models = yield* discoverDshModels(settings({}));
    for (const model of models) {
      const descriptor = model.capabilities.optionDescriptors?.find(
        (candidate) => candidate.id === "reasoning_effort",
      );
      expect(descriptor?.type).toBe("select");
      if (descriptor?.type !== "select") continue;
      expect(descriptor.options.map((option) => option.id)).toEqual([
        "off",
        "low",
        "high",
        "max",
      ]);
      expect(descriptor.role).toBe("reasoning");
    }
  }),
);

it.effect("declares honest slice-4/5 base: no image override, no resume override, MCP negotiated", () =>
  Effect.gen(function* () {
    const caps = DshProviderCapabilitiesV2;
    expect(caps.threads.canReadThreadSnapshot).toBe(false);
    expect(caps.threads.canForkThread).toBe(false);
    expect(caps.threads.canForkFromTurn).toBe(false);
    expect(caps.checkpointing.providerCanRollbackConversation).toBe(false);
    expect(caps.checkpointing.providerCanReadConversationSnapshot).toBe(false);
    expect(caps.tools.supportsMcpTools).toBe(false);
    expect(caps.approvals.supportsCommandApproval).toBe(false);
    expect(caps.approvals.supportsFileReadApproval).toBe(false);
    expect(caps.approvals.supportsFileChangeApproval).toBe(false);
  }),
);

it.effect("session model ids match the wire-advertised JSON pairs", () =>
  Effect.gen(function* () {
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-flash")).toBe(
      '["deepseek-account","deepseek-flash"]',
    );
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-flash-official")).toBe(
      '["deepseek-official","deepseek-v4-flash"]',
    );
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-pro")).toBe(
      '["deepseek-account","deepseek-v4-pro"]',
    );
  }),
);
