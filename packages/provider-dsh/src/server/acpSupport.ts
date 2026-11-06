import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

/**
 * Spawn input for the DeepSeek Harness ACP server.
 *
 * dsh ships as an Electron bundle; the CLI entry is the `dsh.cmd` shim that
 * re-execs the Electron binary with ELECTRON_RUN_AS_NODE. The `--profile acp`
 * process speaks Agent Client Protocol over stdio.
 */
export function buildDshAcpSpawnInput(input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
}): AcpSessionRuntime.AcpSpawnInput {
  return {
      command: input.binaryPath,
      args: ["--profile", "acp"],
      cwd: input.cwd,
      ...(input.baseEnv ? { env: input.baseEnv } : {}),
      extendEnv: true,
    };
}
