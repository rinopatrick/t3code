// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalConsole:off
// Recorder script: owns a raw child process and wall-clock sleeps like the muse recorder does.
/**
 * Captures a live dsh ACP exchange to a normalized replay transcript.
 *
 * Usage (run from apps/server):
 *   node scripts/record-dsh-acp-replay-fixture.ts --out <path> --prompt "<text>"
 *
 * The script performs initialize + session/new + set_config_option(model) +
 * session/prompt, records every JSON-RPC line both directions, normalizes
 * session ids/paths/tokens, and writes an AcpReplayTranscript-compatible file.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const DSH_BIN =
  "C:\\Users\\patri\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const outPath = readArg("--out");
if (!outPath) throw new Error("Pass --out <path>");
const promptText = readArg("--prompt") ?? "reply with exactly: PONG";

interface JsonRpcMessage {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface WireMessage {
  readonly direction: "incoming" | "outgoing";
  readonly message: JsonRpcMessage;
}

const wire: Array<WireMessage> = [];
const sessionIds: Array<string> = [];

function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    let next = value;
    for (const id of sessionIds) next = next.split(id).join("dsh-session-01");
    next = next.replace(/C:[\\/][^"'\s]*/g, "<workspace>");
    next = next.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "user@dsh-replay.example");
    next = next.replace(/\b(sk-|inf_)[A-Za-z0-9_-]{8,}\b/g, "<token>");
    return next;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

function frameLabel(kind: string, method: string, params: unknown): string {
  const update =
    typeof params === "object" && params !== null && "update" in params
      ? (params as Record<string, unknown>).update
      : undefined;
  const updateType =
    typeof update === "object" && update !== null && "sessionUpdate" in update
      ? `:${(update as Record<string, unknown>).sessionUpdate}`
      : "";
  return `${kind}:${method}${updateType}`;
}

function wireToEntries(): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const t3Requests = new Map<string, string>();
  const agentRequests = new Map<string, string>();
  for (const { direction, message } of wire) {
    const type = direction === "outgoing" ? "expect_outbound" : "emit_inbound";
    if (typeof message.method === "string") {
      const isRequest = message.id !== undefined && message.id !== null;
      if (isRequest) {
        (direction === "outgoing" ? t3Requests : agentRequests).set(
          String(message.id),
          message.method,
        );
      }
      const kind = isRequest ? "request" : "notification";
      entries.push({
        type,
        label: frameLabel(kind, message.method, message.params),
        frame: {
          kind,
          method: message.method,
          ...(message.params === undefined ? {} : { params: normalize(message.params) }),
        },
      });
      continue;
    }
    const pending = direction === "outgoing" ? agentRequests : t3Requests;
    const method = pending.get(String(message.id));
    if (method === undefined) continue;
    pending.delete(String(message.id));
    entries.push({
      type,
      label: `response:${method}`,
      frame: {
        kind: "response",
        method,
        ...(message.result === undefined ? {} : { result: normalize(message.result) }),
        ...(message.error === undefined ? {} : { error: normalize(message.error) }),
      },
    });
  }
  return entries;
}

async function main(): Promise<void> {
  const child = NodeChildProcess.spawn(`"${DSH_BIN}"`, ["--profile", "acp"], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`dsh exited early code=${child.exitCode} signal=${child.signalCode}`);
  }
  let buffer = "";
  let sessionId = "";
  let settled = false;

  const send = (message: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      try {
        wire.push({ direction: "outgoing", message: message as JsonRpcMessage });
      } catch {
        /* record-only */
      }
      child.stdin!.write(JSON.stringify(message) + "\n", (error) =>
        error ? reject(error) : resolve(),
      );
    });

  const waitForSessionId = () =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("session/new returned no sessionId")), 30000);
      const check = () => {
        for (const { message } of wire) {
          if (message.id === 2 && typeof message.result === "object" && message.result !== null) {
            const sid = (message.result as Record<string, unknown>).sessionId;
            if (typeof sid === "string") {
              clearTimeout(timer);
              resolve(sid);
              return;
            }
          }
        }
        setTimeout(check, 500);
      };
      check();
    });

  const waitForPromptResult = () =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (settled) {
          resolve();
          return;
        }
        setTimeout(check, 1000);
      };
      check();
    });

  child.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        wire.push({ direction: "incoming", message });
        const text = JSON.stringify(message);
        const match = text.match(/"sessionId":"([0-9a-f-]{36})"/);
        if (match?.[1] && !sessionIds.includes(match[1])) sessionIds.push(match[1]);
        if (message.id === 4) settled = true;
      } catch {
        /* partial line */
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 8000));
  await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "C:/Users/patri/Projects", mcpServers: [] } });
  sessionId = await waitForSessionId();
  if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId);

  await send({
    jsonrpc: "2.0", id: 3, method: "session/set_config_option",
    params: { sessionId, configId: "model", value: "[\"deepseek-account\",\"deepseek-flash\"]" },
  });
  await new Promise((resolve) => setTimeout(resolve, 8000));
  await send({
    jsonrpc: "2.0", id: 4, method: "session/prompt",
    params: { sessionId, prompt: [{ type: "text", text: promptText }] },
  });

  await waitForPromptResult().then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([
    waitForPromptResult(),
    new Promise((resolve) => setTimeout(resolve, 150000)),
  ]);
  finish();

  function finish(): void {
    try {
      child.kill();
    } catch {
      /* already dead */
    }
  }
}

void main().then(
  () => {
    const entries = wireToEntries();
    const transcript = {
      provider: "dsh",
      protocol: "acp",
      version: "1",
      scenario: "dsh_simple",
      metadata: {
        generatedBy: "live-dsh-recorder",
        normalization: "Session ids are dsh-session-01, paths are <workspace>.",
      },
      entries: [...entries, { type: "runtime_exit", status: "success" }],
    };
    NodeFS.writeFileSync(outPath!, JSON.stringify(transcript, null, 1) + "\n");
    console.log(`Wrote ${entries.length} entries to ${outPath}`);
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
