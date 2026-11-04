import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { DshSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { checkDshProviderStatus } from "./status.ts";

const settings = Schema.decodeSync(DshSettings);
const LIVE = process.env.DSH_LIVE === "1";

it.layer(NodeServices.layer)("live", (it) => {
  it.effect("live: real dsh binary reports ready with version", () =>
    Effect.gen(function* () {
      if (!LIVE) return;
      const binaryPath =
        "C:\\Users\\patri\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd";
      const snapshot = yield* checkDshProviderStatus(settings({ enabled: true, binaryPath }));
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(snapshot.models.length).toBeGreaterThan(0);
    }),
  );
});
