// Shared with the client settings form; keep schema code browser-safe.
import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const DshSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("dsh").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description:
          "Path to the DeepSeek Harness CLI on this environment. The runtime resolves its own API key from its own credential store.",
        providerSettingsForm: { placeholder: "dsh", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  { order: ["binaryPath"] },
);
export type DshSettings = typeof DshSettings.Type;
