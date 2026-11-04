import { expect, it } from "@effect/vitest";
import { DshSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DSH_DRIVER_KIND, makeDshAdapterV2Driver } from "./adapter.ts";

const settings = Schema.decodeSync(DshSettings);

it.effect("reports slice-1 capabilities with sessions off", () =>
  Effect.gen(function* () {
    const driver = makeDshAdapterV2Driver();
    const adapter = yield* driver.create({
      instanceId: "test" as never,
      displayName: undefined,
      accentColor: undefined,
      environment: { variables: {}, sources: [] } as never,
      enabled: true,
      config: settings({}),
    });
    const caps = yield* adapter.getCapabilities();
    expect(caps.threads.canCreateEmptyThread).toBe(false);
    expect(caps.threads.canRollbackThread).toBe(false);
    expect(caps.threads.canForkThread).toBe(false);
    expect(caps.turns.supportsInterrupt).toBe(false);
    expect(caps.approvals.supportsCommandApproval).toBe(false);
    expect(adapter.driver).toBe(DSH_DRIVER_KIND);
  }),
);
