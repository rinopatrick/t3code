import { assert, expect, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  ChatImageAttachment,
  MessageId,
  NodeId,
  type OrchestrationV2ProviderThread,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import type { AcpAdapterV2RuntimeInput } from "@t3tools/provider-acp/server/adapter";

import {
  DSH_DRIVER_KIND,
  DshProviderCapabilitiesV2,
  makeDshAcpAdapterFlavor,
  makeDshAdapterV2,
} from "./adapter.ts";
import { DSH_SESSION_MODEL_IDS, discoverDshModels } from "./modelCatalog.ts";

const settings = Schema.decodeSync(DshSettings);

it.effect("reports slice-3 capabilities with model switch on, interrupt on, steering off", () =>
  Effect.sync(() => {
    const parsed = settings({});
    expect(parsed.binaryPath).toBe("dsh");
    const caps = DshProviderCapabilitiesV2;
    expect(caps.sessions.supportsModelSwitchInSession).toBe(true);
    expect(caps.turns.supportsInterrupt).toBe(true);
    expect(caps.turns.supportsSteeringByInterruptRestart).toBe(false);
    expect(caps.turns.supportsQueuedMessages).toBe(true);
    expect(caps.threads.canRollbackThread).toBe(false);
    expect(caps.threads.canForkThread).toBe(false);
    expect(caps.approvals.supportsCommandApproval).toBe(false);
    expect(DSH_DRIVER_KIND).toBe("dsh");
  }),
);

it.effect("model catalog lists account flash, official flash, and pro", () =>
  Effect.gen(function* () {
    const models = yield* discoverDshModels(settings({}));
    expect(models.map((model) => model.slug)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-official",
      "deepseek-v4-pro",
    ]);
  }),
);

it.effect("models advertise the wire reasoning_effort selector", () =>
  Effect.gen(function* () {
    const models = yield* discoverDshModels(settings({}));
    for (const model of models) {
      const descriptor = model.capabilities.optionDescriptors?.find(
        (candidate) => candidate.id === "reasoning_effort",
      );
      expect(descriptor?.type).toBe("select");
      if (descriptor?.type !== "select") continue;
      expect(descriptor.options.map((option) => option.id)).toEqual(["off", "low", "high", "max"]);
      expect(descriptor.role).toBe("reasoning");
    }
  }),
);

it.effect("declares honest slice-4/5 base: MCP on per live wire, snapshot/rollback off", () =>
  Effect.sync(() => {
    const caps = DshProviderCapabilitiesV2;
    expect(caps.threads.canReadThreadSnapshot).toBe(false);
    expect(caps.threads.canForkThread).toBe(false);
    expect(caps.threads.canForkFromTurn).toBe(false);
    expect(caps.checkpointing.providerCanRollbackConversation).toBe(false);
    expect(caps.checkpointing.providerCanReadConversationSnapshot).toBe(false);
    expect(caps.tools.supportsMcpTools).toBe(true);
    expect(caps.approvals.supportsCommandApproval).toBe(false);
    expect(caps.approvals.supportsFileReadApproval).toBe(false);
    expect(caps.approvals.supportsFileChangeApproval).toBe(false);
  }),
);

it.effect("declares MCP on, matching live wire mcpCapabilities.http=true", () =>
  Effect.gen(function* () {
    // dsh_simple initialize carries mcpCapabilities.http=true; the shared
    // MCP-over-ACP bridge activates on that offer, capability stays on.
    expect(DshProviderCapabilitiesV2.tools.supportsMcpTools).toBe(true);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const transcriptPath = yield* path.fromFileUrl(
      new URL(
        "../../../../apps/server/src/orchestration-v2/testkit/fixtures/dsh_simple/dsh_transcript.ndjson",
        import.meta.url,
      ),
    );
    const transcript = yield* fileSystem.readFileString(transcriptPath);
    expect(transcript).toContain('"mcpCapabilities":{"http":true');
    const toolCallPath = yield* path.fromFileUrl(
      new URL(
        "../../../../apps/server/src/orchestration-v2/testkit/fixtures/dsh_tool_call/dsh_transcript.ndjson",
        import.meta.url,
      ),
    );
    const toolCallTranscript = yield* fileSystem.readFileString(toolCallPath);
    expect(toolCallTranscript).toContain('"sessionUpdate":"tool_call"');
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps snapshot off: resume rides the shared session/resume wire path", () =>
  Effect.gen(function* () {
    // dsh_simple initialize offers sessionCapabilities.resume with no
    // loadSession, so shared activateSession prefers resumeSession; T3 keeps
    // canReadThreadSnapshot=false: resume rehydrates inside the agent.
    expect(DshProviderCapabilitiesV2.threads.canReadThreadSnapshot).toBe(false);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const transcriptPath = yield* path.fromFileUrl(
      new URL(
        "../../../../apps/server/src/orchestration-v2/testkit/fixtures/dsh_simple/dsh_transcript.ndjson",
        import.meta.url,
      ),
    );
    const transcript = yield* fileSystem.readFileString(transcriptPath);
    expect(transcript).toContain('"sessionCapabilities":{"close":{},"list":{}');
    expect(transcript).toContain('"resume":{}');
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("session model ids match the wire-advertised JSON pairs", () =>
  Effect.sync(() => {
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-flash")).toBe(
      '["deepseek-account","deepseek-flash"]',
    );
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-flash-official")).toBe(
      '["deepseek-official","deepseek-v4-flash"]',
    );
    expect(DSH_SESSION_MODEL_IDS.get("deepseek-v4-pro")).toBe(
      '["deepseek-account","deepseek-v4-pro"]',
    );
  }),
);

it.effect("dsh flavor does not force image prompts on (unlike grok override)", () =>
  Effect.sync(() => {
    // Only flavor.supportsImagePrompts=true or negotiated image=true turns
    // images on; dsh sets neither, docs/user/providers-dsh.md pins image=false.
    const flavor = makeDshAcpAdapterFlavor({
      instanceId: ProviderInstanceId.make("dsh-flavor-image-off"),
      settings: settings({}),
      environment: {},
      cwd: "/tmp/dsh-flavor-image-off",
      makeRuntime: () => Effect.die("flavor unit test must not spawn a runtime"),
    });
    expect(flavor.supportsImagePrompts).not.toBe(true);
  }),
);

it.effect("dsh resume rides the shared load-vs-resume fallback, snapshot stays off", () =>
  Effect.sync(() => {
    // Shared activateSession falls back to runtime.resumeSession when the
    // wire offers sessionCapabilities.resume (dsh_simple does); snapshot
    // stays off since resume reattaches rather than exposing state.
    expect(DshProviderCapabilitiesV2.threads.canReadThreadSnapshot).toBe(false);
    const flavor = makeDshAcpAdapterFlavor({
      instanceId: ProviderInstanceId.make("dsh-flavor-resume"),
      settings: settings({}),
      environment: {},
      cwd: "/tmp/dsh-flavor-resume",
      makeRuntime: () => Effect.die("flavor unit test must not spawn a runtime"),
    });
    expect(flavor.driver).toBe(DSH_DRIVER_KIND);
  }),
);

const dshTestLayer = Layer.mergeAll(
  NodeServices.layer,
  NodeCrypto.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  ),
);

// dsh_simple initialize: image=false, mcpCapabilities.http=true.
// No flavor override, so image turns must fail before session/prompt.
const DSH_IMAGE_OFF_INITIALIZE = {
  protocolVersion: 1,
  agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
  agentCapabilities: {
    mcpCapabilities: { http: true },
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    sessionCapabilities: { close: {}, list: {}, resume: {} },
  },
  authMethods: [],
};

const fakeImageOffRuntime = (promptCalled: {
  current: boolean;
}): AcpSessionRuntime.AcpSessionRuntime["Service"] => {
  const register = () => Effect.void;
  const startResult = {
    sessionId: "dsh-session-01",
    initializeResult: DSH_IMAGE_OFF_INITIALIZE,
    sessionSetupResult: { sessionId: "dsh-session-01" },
    modelConfigId: undefined,
  } as unknown as AcpSessionRuntime.AcpSessionRuntimeStartResult;
  return {
    handleRequestPermission: register,
    handleElicitation: register,
    handleMcpConnect: register,
    handleMcpMessage: register,
    handleMcpDisconnect: register,
    handleMcpNotification: register,
    handleReadTextFile: register,
    handleWriteTextFile: register,
    handleCreateTerminal: register,
    handleTerminalOutput: register,
    handleTerminalWaitForExit: register,
    handleTerminalKill: register,
    handleTerminalRelease: register,
    handleSessionUpdate: register,
    handleElicitationComplete: register,
    handleUnknownExtRequest: register,
    handleUnknownExtNotification: register,
    handleExtRequest: register,
    handleExtNotification: register,
    initialize: () => Effect.succeed(DSH_IMAGE_OFF_INITIALIZE as never),
    start: () => Effect.succeed(startResult),
    getEvents: () => Stream.empty,
    drainEvents: Effect.void,
    getModeState: Effect.void as never,
    getConfigOptions: Effect.succeed([]),
    configOptionChanges: Stream.empty,
    loadSession: () => Effect.succeed(startResult),
    resumeSession: () => Effect.succeed(startResult),
    forkSession: () => Effect.succeed(startResult),
    listSessions: () => Effect.succeed({ sessions: [] }) as never,
    closeSession: () => Effect.succeed({}) as never,
    deleteSession: () => Effect.succeed({}) as never,
    listProviders: Effect.succeed({ providers: [] }) as never,
    setProvider: () => Effect.succeed({}) as never,
    disableProvider: () => Effect.succeed({}) as never,
    logout: Effect.void as never,
    prompt: () => {
      promptCalled.current = true;
      return Effect.succeed({ stopReason: "end_turn" }) as never;
    },
    cancel: Effect.void,
    setMode: () => Effect.succeed({}) as never,
    setSessionModel: () => Effect.succeed({}) as never,
  } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];
};

it.effect("rejects image turns: dsh negotiates promptCapabilities.image=false", () =>
  Effect.gen(function* () {
    const promptCalled = { current: false };
    const instanceId = ProviderInstanceId.make("dsh-image-off");
    const adapter = yield* makeDshAdapterV2({
      instanceId,
      settings: settings({}),
      environment: {},
      cwd: "/tmp/dsh-image-off",
      makeRuntime: () => Effect.succeed(fakeImageOffRuntime(promptCalled)),
    });
    const threadId = ThreadId.make("thread-dsh-image-off");
    const modelSelection = { instanceId, model: "deepseek-v4-flash" };
    const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      runtimeMode: "approval-required",
      interactionMode: "default",
      cwd: "/tmp/dsh-image-off",
    });
    const session = yield* adapter.openSession({
      threadId,
      providerSessionId: ProviderSessionId.make("provider-session-dsh-image-off"),
      modelSelection,
      runtimePolicy,
    });
    const providerThread = yield* session.ensureThread({
      threadId,
      modelSelection,
      runtimePolicy,
    });
    const now = yield* DateTime.now;
    const suffix = `${threadId}:1`;
    const failure = yield* session
      .startTurn({
        appThread: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make(`project:${threadId}`),
          title: "dsh image-off",
          providerInstanceId: instanceId,
          modelSelection,
          runtimeMode: runtimePolicy.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        threadId,
        runId: RunId.make(`run:${suffix}`),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make(`attempt:${suffix}`),
        rootNodeId: NodeId.make(`node:${suffix}`),
        providerThread,
        message: {
          createdBy: "user",
          creationSource: "web",
          messageId: MessageId.make(`message:${suffix}`),
          text: "what is in this image",
          attachments: [
            ChatImageAttachment.make({
              type: "image",
              id: ChatAttachmentId.make(
                "thread-dsh-image-off-12345678-1234-1234-1234-123456789abc",
              ),
              name: "diagram.png",
              mimeType: "image/png",
              sizeBytes: 4,
            }),
          ],
        },
        modelSelection,
        runtimePolicy,
      })
      .pipe(Effect.flip);
    assert.equal(failure._tag, "ProviderAdapterTurnStartError");
    const cause = failure.cause as { readonly _tag?: string; readonly detail?: string } | undefined;
    assert.equal(cause?._tag, "ProviderAdapterProtocolError");
    assert.equal(cause?.detail, "ACP driver did not negotiate image prompt support");
    assert.isFalse(promptCalled.current, "no session/prompt may go out for an image turn");
  }).pipe(Effect.provide(dshTestLayer), Effect.scoped),
);

// The dsh wire advertises sessionCapabilities.resume with no loadSession, so
// cross-process resume reopens the native session via session/resume (shared
// activateSession/AcpSessionRuntime path) instead of a fresh session/new.
const makeResumableRuntime = (calls: {
  readonly resumedWith: Array<string>;
  readonly loadedWith: Array<string>;
  prompts: number;
}) => {
  const register = () => Effect.void;
  return (
    runtimeInput: AcpAdapterV2RuntimeInput,
  ): AcpSessionRuntime.AcpSessionRuntime["Service"] => {
    const sessionId = runtimeInput.resumeSessionId ?? "dsh-session-01";
    const startResult = {
      sessionId,
      initializeResult: DSH_IMAGE_OFF_INITIALIZE,
      sessionSetupResult: { sessionId },
      modelConfigId: undefined,
    } as unknown as AcpSessionRuntime.AcpSessionRuntimeStartResult;
    return {
      handleRequestPermission: register,
      handleElicitation: register,
      handleMcpConnect: register,
      handleMcpMessage: register,
      handleMcpDisconnect: register,
      handleMcpNotification: register,
      handleReadTextFile: register,
      handleWriteTextFile: register,
      handleCreateTerminal: register,
      handleTerminalOutput: register,
      handleTerminalWaitForExit: register,
      handleTerminalKill: register,
      handleTerminalRelease: register,
      handleSessionUpdate: register,
      handleElicitationComplete: register,
      handleUnknownExtRequest: register,
      handleUnknownExtNotification: register,
      handleExtRequest: register,
      handleExtNotification: register,
      initialize: () => Effect.succeed(DSH_IMAGE_OFF_INITIALIZE as never),
      start: () => Effect.succeed(startResult),
      getEvents: () => Stream.empty,
      drainEvents: Effect.void,
      getModeState: Effect.void as never,
      getConfigOptions: Effect.succeed([]),
      configOptionChanges: Stream.empty,
      loadSession: (loadedId: string) => {
        calls.loadedWith.push(loadedId);
        return Effect.succeed(startResult);
      },
      resumeSession: (resumedId: string) => {
        calls.resumedWith.push(resumedId);
        return Effect.succeed(startResult);
      },
      forkSession: () => Effect.succeed(startResult),
      listSessions: () => Effect.succeed({ sessions: [] }) as never,
      closeSession: () => Effect.succeed({}) as never,
      deleteSession: () => Effect.succeed({}) as never,
      listProviders: Effect.succeed({ providers: [] }) as never,
      setProvider: () => Effect.succeed({}) as never,
      disableProvider: () => Effect.succeed({}) as never,
      logout: Effect.void as never,
      prompt: () => {
        calls.prompts += 1;
        return Effect.succeed({ stopReason: "end_turn" }) as never;
      },
      cancel: Effect.void,
      setMode: () => Effect.succeed({}) as never,
      setSessionModel: () => Effect.succeed({}) as never,
    } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];
  };
};

it.effect("resumes the native session: reopen with the stored native id, then turn", () =>
  Effect.gen(function* () {
    const calls = {
      resumedWith: [] as Array<string>,
      loadedWith: [] as Array<string>,
      runtimeResumeIds: [] as Array<string | undefined>,
      prompts: 0,
    };
    const instanceId = ProviderInstanceId.make("dsh-resume");
    const makeAdapter = () =>
      makeDshAdapterV2({
        instanceId,
        settings: settings({}),
        environment: {},
        cwd: "/tmp/dsh-resume",
        makeRuntime: (runtimeInput) => {
          calls.runtimeResumeIds.push(runtimeInput.resumeSessionId);
          return Effect.succeed(makeResumableRuntime(calls)(runtimeInput));
        },
      });
    const modelSelection = { instanceId, model: "deepseek-v4-flash" };
    const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      runtimeMode: "approval-required",
      interactionMode: "default",
      cwd: "/tmp/dsh-resume",
    });
    const now = yield* DateTime.now;
    const textTurn = (
      threadId: ThreadId,
      providerThread: OrchestrationV2ProviderThread,
      ordinal: number,
      text: string,
    ) => ({
      appThread: {
        createdBy: "user" as const,
        creationSource: "web" as const,
        id: threadId,
        projectId: ProjectId.make(`project:${threadId}`),
        title: "dsh resume",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: runtimePolicy.runtimeMode,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
      threadId,
      runId: RunId.make(`run:${threadId}:${ordinal}`),
      runOrdinal: ordinal,
      providerTurnOrdinal: ordinal,
      attemptId: RunAttemptId.make(`attempt:${threadId}:${ordinal}`),
      rootNodeId: NodeId.make(`node:${threadId}:${ordinal}`),
      providerThread,
      message: {
        createdBy: "user" as const,
        creationSource: "web" as const,
        messageId: MessageId.make(`message:${threadId}:${ordinal}`),
        text,
        attachments: [],
      },
      modelSelection,
      runtimePolicy,
    });
    const threadId = ThreadId.make("thread-dsh-resume");
    const first = yield* makeAdapter();
    const session = yield* first.openSession({
      threadId,
      providerSessionId: ProviderSessionId.make("provider-session-dsh-resume"),
      modelSelection,
      runtimePolicy,
    });
    const providerThread = yield* session.ensureThread({
      threadId,
      modelSelection,
      runtimePolicy,
    });
    yield* session.startTurn(textTurn(threadId, providerThread, 1, "first turn"));
    yield* Stream.runCollect(
      Stream.takeUntil(
        session.events,
        (event) => event.type === "turn.terminal" && event.runOrdinal === 1,
      ),
    );
    // Cross-process resume: a fresh runtime reopens the stored native thread.
    // The adapter must forward it as resumeSessionId so the runtime takes
    // the session/resume path (dsh advertises resume, no loadSession).
    const second = yield* makeAdapter();
    const resumedThreadId = ThreadId.make("thread-dsh-resumed");
    const resumedSession = yield* second.openSession({
      threadId: resumedThreadId,
      providerSessionId: ProviderSessionId.make("provider-session-dsh-resume"),
      modelSelection,
      runtimePolicy,
      initialNativeThreadId: "dsh-session-01",
    });
    const resumed = yield* resumedSession.ensureThread({
      threadId: resumedThreadId,
      modelSelection,
      runtimePolicy,
    });
    yield* resumedSession.startTurn(textTurn(resumedThreadId, resumed, 2, "turn after resume"));
    yield* Stream.runCollect(
      Stream.takeUntil(
        resumedSession.events,
        (event) => event.type === "turn.terminal" && event.runOrdinal === 2,
      ),
    );
    assert.deepEqual(calls.runtimeResumeIds, [undefined, "dsh-session-01"]);
    assert.deepEqual(calls.loadedWith, []);
    assert.equal(calls.prompts, 2);
  }).pipe(Effect.provide(dshTestLayer), Effect.scoped),
);
