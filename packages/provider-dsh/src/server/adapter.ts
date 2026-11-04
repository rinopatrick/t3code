import { ProviderDriverKind, type OrchestrationV2ProviderCapabilities } from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import type * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import type * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import type * as EffectAcpErrors from "effect-acp/errors";
import {
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { buildDshAcpSpawnInput } from "./acpSupport.ts";
import { DSH_SESSION_MODEL_IDS } from "./modelCatalog.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";

export const DSH_DRIVER_KIND = ProviderDriverKind.make("dsh");

const DSH_DEFAULT_SETTINGS = Schema.decodeSync(DshSettings)({});

/**
 * Slice 2 capabilities: what the captured dsh wire proves.
 *
 * - session/new works, model switch via session/set_config_option works
 *   (probed live: official -> account/flash), reasoning_effort advertised.
 * - session/cancel, session/set_model, session/set_config do NOT exist
 *   (method-not-found, probed live). Interrupt stays off; Stop falls back to
 *   local teardown in the runtime.
 * - promptCapabilities.image=false (probed live). Image attachment unsupported.
 */
export const DshProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  threads: {
    ...AcpProviderCapabilitiesV2.threads,
    canCreateEmptyThread: true,
    exposesNativeThreadId: true,
    canReadThreadSnapshot: false,
    canRollbackThread: false,
  },
  turns: {
    ...AcpProviderCapabilitiesV2.turns,
    supportsInterrupt: false,
    supportsSteeringByInterruptRestart: false,
  },
  approvals: {
    ...AcpProviderCapabilitiesV2.approvals,
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
  },
  checkpointing: {
    ...AcpProviderCapabilitiesV2.checkpointing,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export type DshAcpRuntimeInput = AcpSessionRuntime.AcpSessionRuntimeOptions;

export interface DshAdapterV2Options {
  readonly instanceId: ProviderAdapterDriverCreateInput<DshSettings>["instanceId"];
  readonly settings: DshSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly makeRuntime: (
    input: AcpSessionRuntime.AcpSessionRuntimeOptions,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Scope.Scope
  >;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
}

export type DshAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const makeDshAdapterV2 = Effect.fn("makeDshAdapterV2")(function* (
  options: DshAdapterV2Options,
) {
  const makeRuntime = Effect.fn("DshAdapterV2.makeRuntime")(function* (
    input: AcpAdapterV2RuntimeInput,
  ) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* options
      .makeRuntime({
        ...input,
        spawn: buildDshAcpSpawnInput({
          binaryPath: options.settings.binaryPath,
          cwd: options.cwd,
          baseEnv: options.environment,
        }),
        clientInfo: { name: "t3-code", version: "0.0.0" },
        cancelBehavior: "wait-for-prompt",
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
      })
      .pipe(Effect.provideService(Scope.Scope, scope));
  });
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: {
      driver: DSH_DRIVER_KIND,
      capabilities: DshProviderCapabilitiesV2,
      makeRuntime,
      resolveModelId: (selection) =>
        DSH_SESSION_MODEL_IDS.get(selection.model) ?? selection.model,
    },
    selfInvocation: yield* resolveSelfInvocation(),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });
});

export const makeDshAdapterV2Driver = (): ProviderAdapterDriver<
  DshSettings,
  DshAdapterV2DriverEnv
> => ({
  driverKind: DSH_DRIVER_KIND,
  configSchema: DshSettings,
  defaultConfig: (): DshSettings => DSH_DEFAULT_SETTINGS,
  create: Effect.fn("DshAdapterV2Driver.create")(function* (
    input: ProviderAdapterDriverCreateInput<DshSettings>,
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const processEnvironment = yield* HostProcess.Environment;
    const cwd = processEnvironment.PWD ?? process.cwd();
    const random = yield* SecureRandom.SecureRandom;
    const makeRuntime = Effect.fn("DshDriver.makeRuntime")(function* (
      runtimeInput: AcpSessionRuntime.AcpSessionRuntimeOptions,
    ) {
      const context = yield* Layer.build(AcpSessionRuntime.layer(runtimeInput)).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(SecureRandom.SecureRandom, random),
      );
      return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(context),
      );
    });
    return yield* makeDshAdapterV2({
      instanceId: input.instanceId,
      settings: { ...input.config, enabled: input.enabled },
      environment: processEnvironment,
      cwd,
      makeRuntime,
    });
  }),
});
