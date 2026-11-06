import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { DshSettings } from "@t3tools/provider-dsh/settings";
import { buildDshAcpSpawnInput, makeDshAdapterV2 } from "@t3tools/provider-dsh/testing";

import { makeTurnInput } from "./AcpAdapterV2.testkit.ts";

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
// and proves session/cancel settles a live turn as interrupted.
it.layer(layerSession)("live", (it) => {
  it.effect(
    "live: interruptTurn during a sleep prompt settles the turn interrupted",
    () =>
      Effect.gen(function* () {
        if (!LIVE) return;
        const instanceId = ProviderInstanceId.make("dsh-live-interrupt");
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const random = yield* SecureRandom.SecureRandom;
        const binaryPath =
          "C:\\Users\\patri\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd";
        const cwd = "C:/Users/patri/Projects";
        const adapter = yield* makeDshAdapterV2({
          instanceId,
          settings: settings({ binaryPath }),
          environment: process.env,
          cwd,
          makeRuntime: (runtimeInput) => {
            const full = {
              ...runtimeInput,
              spawn: buildDshAcpSpawnInput({ binaryPath, cwd }),
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
        const threadId = ThreadId.make("thread-dsh-live-interrupt");
        const modelSelection = {
          instanceId,
          model: "[\"deepseek-account\",\"deepseek-flash\"]",
        } as const;
        const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd,
        });
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-dsh-live-interrupt"),
          modelSelection,
          runtimePolicy,
        });
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        yield* Effect.forkScoped(
          runtime.startTurn(
            makeTurnInput({
              threadId,
              providerThread,
              instanceId,
              runtimePolicy,
              now,
              messageText:
                "Run the local shell command `sleep 60` and wait for it, then respond exactly: CANCEL-PROBE-DONE",
            }),
          ),
        );
        const started = Option.getOrThrow(
          Option.flatten(
            yield* Effect.timeoutOption(
              runtime.events.pipe(
                Stream.filter(
                  (event) =>
                    event.type === "turn_item.updated" &&
                    event.turnItem.nativeItemRef !== null,
                ),
                Stream.runHead,
              ),
              "120 seconds",
            ),
          ),
        );
        if (started.type !== "turn_item.updated" || started.turnItem.providerTurnId === null) {
          return yield* Effect.die("Expected a turn item with a provider turn id");
        }
        const providerTurnId = started.turnItem.providerTurnId;
        yield* Fiber.join(
          yield* Effect.forkScoped(runtime.interruptTurn({ providerThread, providerTurnId })),
        );
        const terminal = Option.getOrThrow(
          Option.flatten(
            yield* Effect.timeoutOption(
              runtime.events.pipe(
                Stream.filter(
                  (event) =>
                    event.type === "turn.terminal" && event.providerTurnId === providerTurnId,
                ),
                Stream.runHead,
              ),
              "120 seconds",
            ),
          ),
        );
        expect(terminal.type === "turn.terminal" && terminal.status).toBe("interrupted");
      }).pipe(Effect.scoped),
    { timeout: 300_000 },
  );
});
