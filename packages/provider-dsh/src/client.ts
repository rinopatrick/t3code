import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { DshSettings } from "./settings.ts";

export const dshClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("dsh"),
  label: "DeepSeek Harness",
  modelFamilies: ["DeepSeek"],
  settingsSchema: DshSettings,
  icon: {
    viewBox: "0 0 32 32",
    fill: { light: "#4D6BFE", dark: "#4D6BFE" },
    paths: [
      {
        d: "M16 2 L28 9 V23 L16 30 L4 23 V9 Z M16 8 L23 12 V20 L16 24 L9 20 V12 Z",
      },
    ],
  },
});
