import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { DshSettings } from "@t3tools/provider-dsh/settings";
import { DSH_DRIVER_KIND, makeDshAdapterV2 } from "@t3tools/provider-dsh/testing";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as Duration from "effect/Duration";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import type { ProviderReplayGate } from "@t3tools/provider-testing/replayGate";
import * as ProviderAdapterRegistry from "../ProviderAdapterRegistry.ts";
import type { OrchestratorV2ProviderReplayHarness } from "../testkit/ProviderReplayHarness.ts";
import {
  type AcpReplayTranscript,
  AcpReplayTranscriptDecodeError,
  decodeAcpReplayTranscript,
  makeAcpReplayCompletenessAssertion,
  makeAcpReplayRuntime,
} from "./AcpAdapterV2.testkit.ts";

const DEFAULT_DSH_SETTINGS = Schema.decodeSync(DshSettings)({});
const DSH_INSTANCE_ID = ProviderInstanceId.make("dsh");

function layerDshProviderAdapterRegistryReplay(
  transcript: AcpReplayTranscript,
  options: { readonly replayGate?: ProviderReplayGate } = {},
) {
  const layerHost = TestProviderHost.layer().pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

  return ProviderAdapterRegistry.layerFromAdaptersEffect(
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const replayGate = options.replayGate;
      const replayDir = yield* fileSystem
        .makeTempDirectory({
          prefix: `t3-orchestration-v2-dsh-replay-${transcript.scenario}-`,
        })
        .pipe(Effect.orDie);
      const statusPath = path.join(replayDir, "status.json");
      const scriptPath = yield* path
        .fromFileUrl(new URL("../../../scripts/acp-replay-agent.ts", import.meta.url))
        .pipe(Effect.orDie);
      const adapter = yield* makeDshAdapterV2({
        instanceId: DSH_INSTANCE_ID,
        settings: DEFAULT_DSH_SETTINGS,
        environment: {},
        cwd: replayDir,
        assertComplete: makeAcpReplayCompletenessAssertion(fileSystem, statusPath, transcript),
        ...(replayGate === undefined
          ? {}
          : {
              testHooks: {
                onDeferredFinalizeScheduled: (debounce: Duration.Input) =>
                  Effect.sync(() => replayGate.recordFinishArmed(debounce)),
              },
            }),
        makeRuntime: (runtimeInput) =>
          makeAcpReplayRuntime({
            transcript,
            statusPath,
            scriptPath,
            childProcessSpawner,
            fileSystem,
            cancelBehavior: "wait-for-prompt",
            ...(replayGate === undefined ? {} : { replayGate }),
          })(runtimeInput).pipe(Effect.provideService(SecureRandom.SecureRandom, random)),
      });
      return [adapter];
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(layerHost, NodeServices.layer, NodeCrypto.layer, IdAllocator.layer),
    ),
    Layer.merge(
      Layer.effectDiscard(
        Effect.addFinalizer(() => Effect.sync(() => options.replayGate?.releaseAll())),
      ),
    ),
  );
}

export const DshOrchestratorReplayHarness: OrchestratorV2ProviderReplayHarness<
  AcpReplayTranscript,
  AcpReplayTranscriptDecodeError
> = {
  driver: DSH_DRIVER_KIND,
  decodeTranscript: (transcript) => decodeAcpReplayTranscript(transcript, DSH_DRIVER_KIND),
  makeProviderAdapterRegistryLayer: layerDshProviderAdapterRegistryReplay,
};
