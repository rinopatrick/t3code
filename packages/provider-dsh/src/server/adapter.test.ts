import { expect, it } from "@effect/vitest";
import { DshSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DSH_DRIVER_KIND, DshProviderCapabilitiesV2 } from "./adapter.ts";
import { DSH_SESSION_MODEL_IDS, discoverDshModels } from "./modelCatalog.ts";

const settings = Schema.decodeSync(DshSettings);

it.effect("reports slice-2 capabilities with model switch on, interrupt off", () =>
  Effect.gen(function* () {
    const parsed = settings({});
    expect(parsed.binaryPath).toBe("dsh");
    const caps = DshProviderCapabilitiesV2;
    expect(caps.sessions.supportsModelSwitchInSession).toBe(true);
    expect(caps.turns.supportsInterrupt).toBe(false);
    expect(caps.turns.supportsSteeringByInterruptRestart).toBe(false);
    expect(caps.threads.canRollbackThread).toBe(false);
    expect(caps.threads.canForkThread).toBe(false);
    expect(caps.approvals.supportsCommandApproval).toBe(false);
    expect(DSH_DRIVER_KIND).toBe("dsh");
  }),
);

it.effect("model catalog lists flash and pro", () =>
  Effect.gen(function* () {
    const models = yield* discoverDshModels(settings({}));
    expect(models.map((model) => model.slug)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
  }),
);

it.effect("session model ids match the wire-advertised JSON pairs", () =>
  Effect.gen(function* () {
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-flash")).toBe(
      '["deepseek-account","deepseek-flash"]',
    );
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-pro")).toBe(
      '["deepseek-account","deepseek-v4-pro"]',
    );
  }),
);
