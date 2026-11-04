import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { DshSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import { COMPACT_SLASH_COMMAND } from "@t3tools/provider-core/server/snapshotProbe";
import { checkDshProviderStatus } from "./status.ts";

const settings = Schema.decodeSync(DshSettings);

const fakeCli = (source = 'process.stdout.write("0.2.1-rc.5\\n");') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dsh-status-test-" });
    return writeFakeCli({ directory, name: "dsh", source });
  });

it.layer(NodeServices.layer)("Dsh status", (it) => {
  it.effect("does not expose CLI stderr after a failed version check", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const binaryPath = yield* fakeCli(
          'process.stderr.write("secret-test-value");process.exit(2);',
        );
        const snapshot = yield* checkDshProviderStatus(settings({ enabled: true, binaryPath }));
        expect(snapshot.installed).toBe(true);
        expect(snapshot.status).toBe("error");
        expect(snapshot.message).not.toContain("secret-test-value");
      }),
    ),
  );

  it.effect("reports ready with version and models when the CLI runs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const binaryPath = yield* fakeCli();
        const snapshot = yield* checkDshProviderStatus(settings({ enabled: true, binaryPath }));
        expect(snapshot.status).toBe("ready");
        expect(snapshot.message).toBeUndefined();
        expect(snapshot.slashCommands).toEqual([COMPACT_SLASH_COMMAND]);
        expect(snapshot.auth).toEqual({ status: "unknown" });
        expect(snapshot.version).toBe("0.2.1-rc.5");
        expect(snapshot.models.map((model) => model.slug)).toEqual([
          "deepseek-v4-flash",
          "deepseek-v4-pro",
        ]);
      }),
    ),
  );

  it.effect("reports disabled state when the provider is off", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDshProviderStatus(
        settings({ enabled: false, binaryPath: "dsh" }),
      );
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.models).toEqual([]);
    }),
  );
});
