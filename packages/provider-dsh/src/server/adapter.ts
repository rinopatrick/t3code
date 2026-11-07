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
  type AcpAdapterV2Flavor,
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

/** Evidenced by the dsh_simple replay fixture; cancel absent, image off. */
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
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    // Live initialize advertises mcpCapabilities.http=true; the shared
    // MCP-over-ACP bridge activates on that offer. Grok/fx precedent.
    supportsMcpTools: true,
  },
  turns: {
    ...AcpProviderCapabilitiesV2.turns,
    // Proven live: interruptTurn settles a sleep-prompt turn as interrupted
    // via session/cancel (cancelBehavior wait-for-prompt). Steering stays off:
    // interrupt-and-restart steering is unproven on this wire.
    supportsInterrupt: true,
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

export interface DshAdapterV2Options {
  readonly instanceId: ProviderAdapterDriverCreateInput<DshSettings>["instanceId"];
  readonly settings: DshSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly makeRuntime: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Scope.Scope
  >;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly assertComplete?: AcpAdapterV2Flavor["assertComplete"];
  readonly testHooks?: Parameters<typeof makeAcpAdapterV2>[0]["testHooks"];
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

export interface DshAcpAdapterFlavorInput {
  readonly instanceId: ProviderAdapterDriverCreateInput<DshSettings>["instanceId"];
  readonly settings: DshSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly makeRuntime: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Scope.Scope
  >;
  readonly assertComplete?: AcpAdapterV2Flavor["assertComplete"];
}

export const makeDshAcpAdapterFlavor = (input: DshAcpAdapterFlavorInput): AcpAdapterV2Flavor => {
  const makeRuntime = Effect.fn("DshAdapterV2.makeRuntime")(function* (
    runtimeInput: AcpAdapterV2RuntimeInput,
  ) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* input.makeRuntime(runtimeInput).pipe(Effect.provideService(Scope.Scope, scope));
  });
  return {
    driver: DSH_DRIVER_KIND,
    capabilities: DshProviderCapabilitiesV2,
    makeRuntime,
    resolveModelId: (selection) => DSH_SESSION_MODEL_IDS.get(selection.model) ?? selection.model,
    ...(input.assertComplete === undefined ? {} : { assertComplete: input.assertComplete }),
  };
};

export const makeDshAdapterV2 = Effect.fn("makeDshAdapterV2")(function* (
  options: DshAdapterV2Options,
) {
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeDshAcpAdapterFlavor(options),
    selfInvocation: yield* resolveSelfInvocation(),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    ...(options.testHooks === undefined ? {} : { testHooks: options.testHooks }),
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
      runtimeInput: AcpAdapterV2RuntimeInput,
    ) {
      const fullInput: AcpSessionRuntime.AcpSessionRuntimeOptions = {
        ...runtimeInput,
        spawn: buildDshAcpSpawnInput({
          binaryPath: input.config.binaryPath,
          cwd,
          baseEnv: processEnvironment,
        }),
        clientInfo: { name: "t3-code", version: "0.0.0" },
        cancelBehavior: "wait-for-prompt",
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
      };
      const context = yield* Layer.build(AcpSessionRuntime.layer(fullInput)).pipe(
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
