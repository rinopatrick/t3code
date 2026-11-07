import { assert } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@t3tools/contracts";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertBaseProjection,
  assertSemanticProjectionIntegrity,
  assertUserMessagesInclude,
  assertVisibleTurnItemsMirrorLocalTurnItems,
  projectionFor,
  SIMPLE_PROMPT,
} from "../shared.ts";

export function assertDshSimpleOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  assertBaseProjection({
    result,
    transcript,
    runCount: 1,
    runStatuses: ["completed"],
  });

  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assertVisibleTurnItemsMirrorLocalTurnItems(projection);
  assertUserMessagesInclude(projection, [SIMPLE_PROMPT]);
  assert.equal(projection.providerTurns[0]?.status, "completed");
  const usageThread = projection.providerThreads.find((thread) => thread.contextUsage !== null);
  assert.isDefined(usageThread, "usage_update must land on a provider thread");
  assert.deepInclude(usageThread?.contextUsage, {
    usedTokens: 25886,
    maxTokens: 1048576,
  });

  // The recorded wire advertisement this replay replays: initialize offers
  // promptCapabilities.image=false, mcpCapabilities.http=true, and a
  // sessionCapabilities.resume hook. This pins the fixture as a real dsh
  // transcript exhibiting the closed ACP gap.
  const initializeEntry = transcript.entries.find(
    (entry) =>
      entry.type === "emit_inbound" &&
      typeof entry.frame === "object" &&
      entry.frame !== null &&
      (entry.frame as { readonly kind?: unknown }).kind === "response" &&
      (entry.frame as { readonly method?: unknown }).method === "initialize",
  );
  const initializeResult =
    initializeEntry !== undefined && initializeEntry.type === "emit_inbound"
      ? (initializeEntry.frame as { readonly result?: unknown })
      : undefined;
  const agentCapabilities = (initializeResult?.result ?? {}) as {
    readonly agentCapabilities?: {
      readonly promptCapabilities?: { readonly image?: unknown };
      readonly mcpCapabilities?: { readonly http?: unknown };
      readonly sessionCapabilities?: { readonly resume?: unknown };
    };
  };
  assert.equal(
    agentCapabilities.agentCapabilities?.promptCapabilities?.image,
    false,
    "dsh transcript must advertise promptCapabilities.image=false",
  );
  assert.equal(
    agentCapabilities.agentCapabilities?.mcpCapabilities?.http,
    true,
    "dsh transcript must advertise mcpCapabilities.http=true",
  );
  assert.isDefined(
    agentCapabilities.agentCapabilities?.sessionCapabilities?.resume,
    "dsh transcript must advertise sessionCapabilities.resume",
  );
}
