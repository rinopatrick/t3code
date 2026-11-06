# DeepSeek Harness

DeepSeek Harness (`dsh`) is disabled by default. Install DeepSeek Harness on
the machine hosting your environment, then sign in inside the harness so it
holds its own API key.

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable **DeepSeek Harness**. Set **Binary path** if `dsh` is not on the
host's `PATH`. Refresh provider status after installation or sign-in, then
select DeepSeek in a thread's model picker.

Provider status does not check your sign-in. It reports the CLI version and
leaves auth unknown until the first turn, because `dsh` resolves its own key
from its own credential store at session time.

## Sign-in and API keys

`dsh` ships as an Electron bundle; the CLI entry is the `dsh.cmd` shim. It
resolves its own API key from its own credential store. If a turn fails with
"no API key for provider route", store the key through the harness's own
credential service or export it in the launching environment. T3 Code never
sees the key.

The default `deepseek-v4-flash` route reads `DEEPSEEK_API_KEY`. The
`DeepSeek-V4.1-Flash` and `DeepSeek-V4-Pro` account routes use the harness
sign-in.

## Remote access and instances

Connect from web, desktop, or mobile through [remote access](./remote-access.md).
DeepSeek Harness uses the selected environment's files and sign-in; connecting
devices do not need it installed. Install and sign in separately on each host
where you want it to run.

Add a provider instance for a separate configuration. Instances on the same
host share its harness sign-in. Existing conversations retain their instance
when its model catalog becomes unavailable.

## Models

The model picker lists `deepseek-v4-flash`, `DeepSeek-V4.1-Flash`,
`DeepSeek-V4-Pro`, and `DeepSeek V4 Flash (Official API)`, matching the
harness's own `session/new` catalog. Each model offers the harness's
`reasoning_effort` selector: off, low, high, max. High is the default. After
changing harness configuration, refresh provider status in
**Settings → Providers**.

## Permissions and limitations

DeepSeek Harness offers two [permission modes](./permission-modes.md):
**Supervised** asks before commands and edits, and **Full access** runs them
without asking.

Image input is not supported. The harness advertises
`promptCapabilities.image=false`, and inline image prompts are rejected by the
wire before they run. Send text only.

Tool calls, MCP tools, and session resume work through the harness's ACP
server. Context usage from the harness's `usage_update` frames appears as the
thread's context usage. Approvals, thread rollback, and conversation rewind
are unavailable: the harness wire has no approval requests, no session/load,
and no truncation, so T3 Code declares them off rather than imitating them.
Forking starts a new session with a copy of the conversation context.

To stop using DeepSeek Harness in an environment, disable it in
**Settings → Providers**. This keeps the host's harness sign-in, thread
history, and workspace files.
