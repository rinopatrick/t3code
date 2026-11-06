import { describe } from "@effect/vitest";

import { DshOrchestratorReplayHarness } from "../Adapters/DshAdapterV2.testkit.ts";
import { itRunsReplayFixtures, runReplayFixture } from "./ProviderReplayFixtures.ts";

describe("dsh replay fixtures", () => {
  itRunsReplayFixtures("dsh", (input) =>
    runReplayFixture({ ...input, harness: DshOrchestratorReplayHarness }),
  );
});
