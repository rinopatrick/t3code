import type { OrchestratorFixtureInput } from "../shared.ts";

/**
 * One turn that lists the workspace directory, recorded live against
 * dsh 0.2.1-rc.5. The agent emits tool_call + tool_call_update frames
 * before the final message chunk.
 */
export function dshToolCallInput(): OrchestratorFixtureInput {
  return {
    steps: [
      {
        type: "message",
        text: "what files are in the current directory? reply with the first filename only",
      },
    ],
  };
}
