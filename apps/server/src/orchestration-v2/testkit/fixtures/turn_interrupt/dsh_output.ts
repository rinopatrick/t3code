import { assert } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@t3tools/contracts";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertBaseProjection,
  assertSemanticProjectionIntegrity,
  assertTurnItemTypes,
  assertUserMessagesInclude,
  assertVisibleTurnItemsMirrorLocalTurnItems,
  projectionFor,
  TURN_INTERRUPT_PROMPT,
} from "../shared.ts";

type ReplayEntry = ProviderReplayTranscript["entries"][number];

function sessionUpdateOf(entry: ReplayEntry): Record<string, unknown> | undefined {
  if (entry.type !== "emit_inbound") return undefined;
  const frame = entry.frame;
  const params =
    typeof frame === "object" && frame !== null && "params" in frame ? frame.params : undefined;
  const update =
    typeof params === "object" && params !== null && "update" in params ? params.update : undefined;
  return typeof update === "object" && update !== null
    ? (update as Record<string, unknown>)
    : undefined;
}

function isSessionUpdate(entry: ReplayEntry, sessionUpdate: string, status?: string): boolean {
  if (entry.type !== "emit_inbound") return false;
  const update = sessionUpdateOf(entry);
  return (
    update?.["sessionUpdate"] === sessionUpdate &&
    (status === undefined || update?.["status"] === status)
  );
}

/** Stop reaches dsh while its sleep command runs; dsh fails the tool call and T3 marks it interrupted. */
export function assertDshTurnInterruptOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  const cancelIndex = transcript.entries.findIndex(
    (entry) => entry.type === "expect_outbound" && entry.label === "notification:session/cancel",
  );
  assert.isAbove(cancelIndex, 0, "dsh interrupt fixture must send session/cancel");
  const preCancel = transcript.entries.slice(0, cancelIndex);
  const postCancel = transcript.entries.slice(cancelIndex);
  const runningTool = preCancel.some((entry) => isSessionUpdate(entry, "tool_call", "in_progress"));
  assert.isTrue(runningTool, "dsh must report the tool call in_progress before the cancel");
  const failedTool = postCancel.some((entry) => isSessionUpdate(entry, "tool_call_update", "failed"));
  assert.isTrue(failedTool, "dsh must fail the tool call after the cancel");

  assertBaseProjection({ result, transcript, runCount: 1, runStatuses: ["interrupted"] });

  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assertVisibleTurnItemsMirrorLocalTurnItems(projection);
  assertTurnItemTypes(projection, [
    "user_message",
    "run_interrupt_request",
    "assistant_message",
    "dynamic_tool",
    "run_interrupt_result",
  ]);
  assertUserMessagesInclude(projection, [TURN_INTERRUPT_PROMPT]);

  const toolItem = projection.turnItems.find((item) => item.type === "dynamic_tool");
  assert.isDefined(toolItem);
  assert.equal(toolItem.status, "interrupted");
  const interruptRequest = projection.turnItems.find(
    (item) => item.type === "run_interrupt_request",
  );
  const interruptResult = projection.turnItems.find((item) => item.type === "run_interrupt_result");
  assert.isDefined(interruptRequest);
  assert.isDefined(interruptResult);
  assert.equal(interruptRequest.status, "completed");
  assert.equal(interruptResult.status, "interrupted");
  assert.equal(interruptResult.parentItemId, interruptRequest.id);
  assert.deepEqual(
    projection.attempts.map((attempt) => attempt.status),
    ["interrupted"],
  );
  assert.deepEqual(
    projection.nodes.map((node) => node.status),
    ["interrupted", "completed", "interrupted"],
  );
  const toolNodes = projection.nodes.filter((node) => node.kind === "tool_call");
  assert.lengthOf(toolNodes, 1);
  assert.equal(toolNodes[0]?.status, "interrupted");
  assert.isFalse(projection.turnItems.some((item) => item.status === "running"));
  assert.equal(projection.providerThreads[0]?.status, "idle");
  assert.include(["interrupted", "cancelled"], projection.providerTurns[0]?.status);
}
