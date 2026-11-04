import { ServerProviderModel } from "@t3tools/contracts";
import { DshSettings } from "../settings.ts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/process/ChildProcess";

import { parseDshVersion } from "./maintenance.ts";
import { discoverDshModels, dshModelCapabilities } from "./modelCatalog.ts";
import {
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  providerModelsFromSettings,
  spawnAndCollect,
  type ProviderProbeResult,
} from "@t3tools/provider-core/server/snapshotProbe";

const DSH_PRESENTATION = {
  displayName: "DeepSeek Harness",
  showInteractionModeToggle: false,
  reportsContextWindow: false,
  supportedRuntimeModes: ["approval-required", "full-access"],
} as const;

const FALLBACK_CAPABILITIES = dshModelCapabilities();

export const makePendingDshProvider = Effect.fn("makePendingDshProvider")(function* (
  settings: DshSettings,
) {
  return buildServerProvider({
    presentation: DSH_PRESENTATION,
    enabled: settings.enabled,
    checkedAt: DateTime.formatIso(yield* DateTime.now),
    models: providerModelsFromSettings([], settings.customModels, FALLBACK_CAPABILITIES),
    slashCommands: settings.enabled ? [COMPACT_SLASH_COMMAND] : [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: settings.enabled
        ? "Checking DeepSeek Harness CLI availability..."
        : "DeepSeek Harness is disabled in T3 Code settings.",
    },
  });
});

export const checkDshProviderStatus = Effect.fn("checkDshProviderStatus")(function* (
  settings: DshSettings,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
) {
  if (!settings.enabled) return yield* makePendingDshProvider(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const snapshot = (probe: ProviderProbeResult, models: ReadonlyArray<ServerProviderModel> = []) =>
    buildServerProvider({
      presentation: DSH_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings(models, settings.customModels, FALLBACK_CAPABILITIES),
      slashCommands: [COMPACT_SLASH_COMMAND],
      probe,
    });
  const versionResult = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(
      settings.binaryPath,
      ["--version"],
      environment ? { env: environment } : {},
    );
    return yield* spawnAndCollect(
      settings.binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
        ...(cwd ? { cwd } : {}),
      }),
    );
  }).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(versionResult)) {
    const missing = isCommandMissingCause(versionResult.failure);
    return snapshot({
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? "DeepSeek Harness CLI (`dsh`) was not found. Install DeepSeek Harness on this T3 server host."
        : "Failed to execute DeepSeek Harness CLI. Check its binary path on this T3 server host.",
    });
  }
  if (Option.isNone(versionResult.success)) {
    return snapshot({
      installed: true,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: "DeepSeek Harness CLI version check timed out.",
    });
  }
  const versionOutput = versionResult.success.value;
  const version = parseDshVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return snapshot({
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: "DeepSeek Harness CLI is installed but failed to run.",
    });
  }

  const models = yield* discoverDshModels(settings);
  // dsh resolves its own API key from its own credential store; the probe
  // never opens a session, so auth stays unknown until the first turn.
  return snapshot(
    {
      installed: true,
      version,
      auth: { status: "unknown" },
      ...(models.length > 0
        ? { status: "ready" }
        : {
            status: "warning",
            message: "DeepSeek Harness returned no models.",
          }),
    },
    models,
  );
});
