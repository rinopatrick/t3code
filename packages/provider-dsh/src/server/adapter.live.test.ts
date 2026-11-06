import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Layer from "effect/Layer";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { buildDshAcpSpawnInput } from "./acpSupport.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { DshSettings } from "../settings.ts";
import { makeDshAdapterV2 } from "./adapter.ts";

const settings = Schema.decodeSync(DshSettings);
const LIVE = process.env.DSH_LIVE === "1";

const layerSession = Layer.mergeAll(
  NodeServices.layer,
  NodeCrypto.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  ),
);

// Gated on DSH_LIVE: without it this test returns immediately on the
// TestClock without spawning. With DSH_LIVE=1 it drives the real binary
// (wall-clock subprocess work) like the acp clientTerminals live tests.
it.layer(layerSession)("live", (it) => {
  it.effect(
    "live: openSession starts the real dsh runtime and reports capabilities",
    () =>
      Effect.gen(function* () {
        if (!LIVE) return;
        const instanceId = ProviderInstanceId.make("dsh-live-test");
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const random = yield* SecureRandom.SecureRandom;
        const binaryPath =
          "C:\\Users\\patri\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd";
        const adapter = yield* makeDshAdapterV2({
          instanceId,
          settings: settings({ binaryPath }),
          environment: process.env,
          cwd: "C:/Users/patri/Projects",
          makeRuntime: (runtimeInput) => {
            const full = {
              ...runtimeInput,
              spawn: buildDshAcpSpawnInput({ binaryPath, cwd: "C:/Users/patri/Projects" }),
            };
            return Layer.build(AcpSessionRuntime.layer(full)).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
              Effect.provideService(SecureRandom.SecureRandom, random),
              Effect.flatMap((context) =>
                Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
                  Effect.provide(context),
                ),
              ),
            );
          },
        });
        const caps = yield* adapter.getCapabilities();
        expect(caps.sessions.supportsModelSwitchInSession).toBe(true);
        expect(caps.turns.supportsInterrupt).toBe(true);
        const session = yield* adapter.openSession({
          threadId: ThreadId.make("thread-dsh-live"),
          providerSessionId: ProviderSessionId.make("provider-session-dsh-live"),
          modelSelection: { instanceId, model: "[\"deepseek-account\",\"deepseek-flash\"]" },
          runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd: "C:/Users/patri/Projects",
          }),
        });
        expect(session.providerSession.status).toBe("ready");
        expect(session.providerSession.model).toContain("deepseek");
      }).pipe(Effect.scoped),
    { timeout: 120_000 },
  );
});
