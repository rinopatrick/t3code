import { ProviderDriverKind, type OrchestrationV2ProviderCapabilities } from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  ProviderAdapterDriver,
  ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import {
  ProviderAdapterOpenSessionError,
  ProviderAdapterProtocolError,
} from "@t3tools/provider-core/server/ProviderAdapter";

export const DSH_DRIVER_KIND = ProviderDriverKind.make("dsh");

const DSH_DEFAULT_SETTINGS = Schema.decodeSync(DshSettings)({});

// Slice 1: sessions come in slice 2. The capability map is declared here so
// reviewers see the honest shape up front: no session-backed behavior yet.
export const DshProviderCapabilitiesV2 = {
  runtimePolicy: { enforcement: "native" },
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: false,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: false,
    canReadThreadSnapshot: false,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: false,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: false,
    emitsTurnCompleted: false,
    supportsInterrupt: false,
    supportsActiveSteering: false,
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: false,
    terminalStatusQuality: "weak",
  },
  streaming: {
    streamsAssistantText: false,
    streamsReasoning: false,
    streamsToolOutput: false,
    streamsPlanText: false,
    emitsMessageCompleted: false,
  },
  tools: {
    exposesToolItemIds: false,
    emitsToolStarted: false,
    emitsToolCompleted: false,
    emitsToolOutput: false,
    supportsMcpTools: false,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: false,
    approvalCallbacksAreLiveOnly: false,
    approvalsCanOriginateFromSubagents: false,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: false,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: false,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: false,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: false,
    acceptsDeveloperContext: false,
    acceptsSyntheticUserContext: false,
    canGenerateSummaries: false,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: false,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
    providerCanReadConversationSnapshot: false,
  },
  identity: {
    nativeThreadIds: "weak",
    nativeTurnIds: "weak",
    nativeItemIds: "weak",
    nativeRequestIds: "weak",
  },
} satisfies OrchestrationV2ProviderCapabilities;

export type DshAdapterV2DriverEnv = never;

/**
 * Slice 1 adapter: reports the honest slice-1 capability map; every session
 * open fails with a typed error until slice 2 provides the transport.
 */
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
    return {
      instanceId: input.instanceId,
      driver: DSH_DRIVER_KIND,
      getCapabilities: () => Effect.succeed(DshProviderCapabilitiesV2),
      planSelectionTransition: () =>
        Effect.fail(
          new ProviderAdapterProtocolError({
            driver: DSH_DRIVER_KIND,
            detail: "DeepSeek Harness sessions are not implemented yet (slice 2).",
          }),
        ),
      openSession: (open) =>
        Effect.fail(
          new ProviderAdapterOpenSessionError({
            driver: DSH_DRIVER_KIND,
            providerSessionId: open.providerSessionId,
            cause: "slice-1-no-session-transport",
          }),
        ),
    };
  }),
});
