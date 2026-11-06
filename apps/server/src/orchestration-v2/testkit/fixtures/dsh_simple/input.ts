import type { OrchestratorFixtureInput } from "../shared.ts";
import { SIMPLE_PROMPT } from "../shared.ts";

/**
 * One PONG turn recorded live against dsh 0.2.1-rc.5
 * (initialize + session/new + set_config_option + session/prompt).
 * The agent answers with thought + message chunks and usage_update,
 * stopReason end_turn.
 */
export function dshSimpleInput(): OrchestratorFixtureInput {
  return {
    steps: [{ type: "message", text: SIMPLE_PROMPT }],
  };
}
