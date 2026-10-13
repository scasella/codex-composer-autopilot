# Composer Autopilot

Generate suggested next user messages in **all loaded sessions or only the
sessions you choose**. Pi and Claude Code offer Tab-to-accept suggestions or
automatic sending. Codex desktop offers automatic sending. No window switching
or synthetic keyboard events.

**Zero npm dependencies, no build step, no MCP server, no telemetry.** Each harness
is off until explicitly enabled and has its own independent settings.

## Pi

```sh
pi install git:github.com/scasella/codex-composer-autopilot
```

Start a new Pi session, or run `/reload` in an existing session, then:

```text
/composer on
/composer status
/composer off
```

The native extension uses your current model and credentials. Tested with Pi
1.1.0 (`@earendil-works/pi-coding-agent`) and Node 25; the package requires Node
22.4+. It needs Pi's `agent_before_settle` and model-registry streaming APIs.

## Claude Code

```sh
claude plugin marketplace add scasella/codex-composer-autopilot
claude plugin install composer-autopilot@scasella-composer-autopilot
```

Start a new Claude Code session and use the same `/composer` commands. This is a
native JavaScript mod using `model.fork` and `prompt.submit`; it requires a Claude
Code release with the mods API. Validated with Claude Code **2.1.296**. Older
releases with only shell hooks cannot run this integration.

## Pi and Claude Code controls

| Command | Effect |
| --- | --- |
| `/composer on` or `/composer on here` | Enable only this session |
| `/composer on all` | Enable all sessions with this integration loaded, preserving exclusions |
| `/composer on ID ID` | Replace the selection with these complete session IDs |
| `/composer off` | Disable automatic sending throughout this harness |
| `/composer off here` or `/composer off ID` | Persistently exclude these sessions |
| `/composer status` | Show this session ID, scope, exclusions, limit, and last outcome |
| `/composer sessions` | List sessions that have registered, including previously closed sessions |
| `/composer mode suggest` | Show a suggestion for Tab to accept; never send it automatically |
| `/composer mode auto` | Explicitly opt into automatic sending |
| `/composer limit 10` | Set the maximum automatic follow-ups per session between human messages |

Suggestion mode is the default. Choose your target scope:

```text
/composer on all
```

Use `/composer mode auto` to opt into automatic sending, or
`/composer mode suggest` to return to Tab acceptance.

Claude Code shows native dim text in the empty prompt box. Pi shows a
“Tab to accept” preview above the editor. **Tab copies the suggestion into the
draft; Enter sends it only when you press it.** You can edit or ignore the draft.
Pi's preview disappears on typing, Escape, a session change, or another command;
normal Tab behavior is preserved when there is no preview. Suggest mode does not
run in headless sessions and does not consume the automatic-follow-up limit.
The exact prediction prompt is the same in both modes.

Delivery mode applies to the saved target scope within this harness. Changing it
does not enable a disabled plugin or change your selected sessions. New installations remain OFF and default to suggestion mode when enabled.
Legacy settings with no saved delivery choice also default to suggestions.
An existing saved `auto` or `suggest` choice is preserved; use
`/composer mode suggest` to change a saved auto setting.
Switching mode cancels pending delivery; it does not retract already-submitted
work. A native Claude suggestion already displayed may remain until the next edit
or turn, but accepting it still requires your action and never sends it itself.

**Upgrade:** update/reload every loaded instance before using the new setting.
The first settings change writes config version 2, which older auto-only plugins
reject rather than continuing automatic sending. Pi: `pi update git:github.com/scasella/codex-composer-autopilot` then `/reload`.
Claude Code: `claude plugin marketplace update scasella-composer-autopilot`,
`claude plugin update composer-autopilot@scasella-composer-autopilot`, then start a
new session. This update does not change Codex desktop behavior.

`on ID` removes that ID from exclusions. `on all` preserves them. Settings are
shared across local processes of the same harness; Pi commands do not change
Claude Code or Codex settings. All-mode also covers future sessions that load the
plugin. Existing processes must load/reload it first. Closed sessions stay closed.
Enabling acts on future completed turns; it does not replay an old answer.

There is no background daemon for Pi or Claude Code. Each loaded integration
reacts to its own session's completed turns. Only one live process should own a
given session ID. State lives in `~/.pi/agent/composer-autopilot` and
`~/.claude/composer-autopilot`; override these with `COMPOSER_PI_HOME` or
`COMPOSER_CLAUDE_HOME`. State stores IDs, counters and outcomes, not prediction
text. A submission marked `submitted` means the native host accepted it, not that
the resulting coding task succeeded.

### Prompt and behavior

Both integrations use the byte-exact **Composer prompt version 5** retrieved from
Codex's prediction configuration on October 13, 2026, saved in
[`prompts/composer-v5.txt`](prompts/composer-v5.txt). Its SHA-256 is
`bf64e2c1b0e11dca1a982ab95e77afc4046422b3605849fb9d9da0fdca069418`.
A JSON output constraint is appended separately; the original prompt is unchanged.

Pi sends a separate prediction request with the current conversation and system
prompt, requesting high reasoning. Claude uses its native conversation fork with
the host's model settings. These reuse the prompt, not Codex's private prediction
mode or model, so prediction quality and wording can differ. The saved prompt
assumes manual review; enabling Autopilot explicitly opts into automatic sending.
Prediction calls and subsequent turns consume your normal model quota.

The default limit is **10 automatic follow-ups per session between human
messages**. A human message resets the count; changing settings also resets it on
the next completed turn. The accepted range is 1–1000. At the limit, status shows
`PAUSED`. Null predictions do nothing. Invalid JSON, unavailable model output, and
ambiguous sends stop that session until explicitly re-enabled for a future turn.
Predictions must be one natural message of at most 240 characters.

The integrations check targeting again before submission and skip nonempty text
drafts, pending continuations, interrupted turns, and stale contexts. Typing or
switching sessions cancels pending work. Draft checks use the host's text API;
they cannot inspect attachment-only drafts. A durable reservation prevents replay
of the same completed turn after a reload. Native submission and suggestion display need no foreground
focus. OFF prevents a pending prediction from submitting; it cannot recall a
prompt already handed to the host or stop a running agent turn. Ordinary harness
permission controls still apply.

These are experimental integrations. Unit tests cover submission and cancellation;
Claude's native mod runner and Pi's extension loader are also checked. Live model
quality and unattended operation across different providers are not yet verified.

## Codex desktop

Codex uses its actual Composer predictions through a small local Node controller.
The adapter supports **macOS** and Node **22.4+**, and checks the running renderer
interface instead of pinning an app version. Unknown interfaces stop without
sending. This uses a private desktop interface and is not an official OpenAI feature.

## Install as a Codex plugin

```sh
codex plugin marketplace add scasella/codex-composer-autopilot
codex plugin add composer-autopilot@scasella-composer-autopilot
```

Open a new chat and ask:

> Use Composer Autopilot to enable predictions for all active chats except this one.

Or:

> Enable Composer Autopilot only for my “API cleanup” and “Landing page” chats.

The skill resolves titles to thread IDs and runs the bundled controller. It can
also check status, exclude a chat, or turn it off. Installing the plugin does not
start sending. This repository is a GitHub plugin marketplace; it is not a listing
in OpenAI's public plugin directory.

## Run Codex directly

```sh
git clone https://github.com/scasella/codex-composer-autopilot.git
cd codex-composer-autopilot
node bin/autopilot.mjs doctor
```

The app needs a local debugging connection. If it is not already enabled, quit
Codex when convenient, then run:

```sh
node bin/autopilot.mjs launch
node bin/autopilot.mjs doctor
node bin/autopilot.mjs threads
```

`launch` opens the app in the background with debugging bound to `127.0.0.1:9222`.
It never quits a running app. Keep the port local: it exposes control of your
signed-in desktop renderer to local processes.

Choose a target scope:

```sh
# All ongoing local chats, including ones that become active later.
node bin/autopilot.mjs on --all

# Only particular ongoing chats. Replace these values with IDs from threads.
node bin/autopilot.mjs on --thread THREAD_UUID --thread ANOTHER_THREAD_UUID

# Persistent exclusions work in either mode.
node bin/autopilot.mjs exclude THREAD_UUID
node bin/autopilot.mjs include THREAD_UUID

# Simple on/off and status; on without options reuses the saved scope.
node bin/autopilot.mjs off
node bin/autopilot.mjs on
node bin/autopilot.mjs status
```

When enabling from inside Codex, add `--exclude-current` to `on` to keep the
control chat from repeatedly prompting itself. In a normal Terminal, use
`--exclude THREAD_UUID` instead. Exclusions persist across restarts. In selected
mode, `include` also adds the thread to the selected set.

Close the terminal after enabling; the controller runs independently. It continues
until stopped, logout, or shutdown. It is not installed as a login item. After an
app restart it reconnects if debugging remains enabled.

## Codex behavior

The controller watches ongoing local chats and reads their actual Composer
predictions after completed turns. It submits the exact prediction through the
app's normal follow-up path. It does not press global keys, select tabs, change
models, or modify permission settings.

- Skips drafts, queued messages, pending requests, active goals, and plan mode.
- Excludes archived chats, subagents, ephemeral chats, remote hosts, and cloud chats.
- Does not revive old history. Selected IDs must become active in the app to be watched.
- An abstention produces no send. Normal prediction generation uses your account.
- Rechecks the target and source turn before sending. Records a durable reservation
  first; interrupted or ambiguous sends are never retried automatically.
- OFF cancels pending predictions. A submission already handed to the app is not
  recalled, and running agent work is not interrupted.

Automatic sending can start further work and consume quota. Predictions can contain
instructions or approval-like language. Choose the chats you want to run unattended;
the controller does not interpret or rewrite prediction text.

## Compatibility across app updates

Asset hashes, minified export names, and local identifier names are discovered at
runtime from the app's loaded modules. An app version change alone does not block
operation. The controller requires exactly one match for each supported helper
signature: history, busy state, continuation eligibility, drafts, scope traversal,
and normal follow-up submission. It uses only local app code; no remote adapters
are downloaded.

Runtime guards check conversation, queue, draft, and prediction response shapes.
An unknown queue blocks that chat until its contents load. A detected contract
failure disables the controller, cancels pending predictions, and records
`OFF — incompatible`. It does not automatically retry an incompatible interface.
Run `doctor` after updating the plugin, then explicitly run `on` to resume your
saved selection. An already-submitted turn cannot be recalled.

These checks are conservative: even a harmless refactor of a required helper can
require a plugin update. They do not prove the behavior of every private internal
callee. The read-only adapter was verified on Codex 26.1007.30912; renamed assets
and exports are tested synthetically. Future desktop releases still need validation.

## Codex state and troubleshooting

Run `status --json` for the state directory. By default it is
`~/.local/state/codex-composer-autopilot` (or under `XDG_STATE_HOME`).
`config.json` holds targets and exclusions; `ledger.json` prevents duplicate sends;
`events.jsonl` records outcomes, turn/message IDs, and foreground observations.
Prediction text is kept in the renderer and is not written to these logs.

`ON — waiting` means the controller is enabled but cannot currently use the app;
read the error and run `doctor`. Multiple main windows are rejected because the
adapter has only been validated with one main window. A second controller is
refused while the first is active.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_APP_PATH` | Override the desktop `.app` location |
| `COMPOSER_AUTOPILOT_HOME` | Override the controller's state directory |
| `CODEX_THREAD_ID` | Used by `on --exclude-current` inside Codex |

Use `--port NUMBER` with `on`, `launch`, or `doctor` for a different loopback port.
Turn OFF before changing a running controller's port. Stop it before uninstalling
or deleting the package. Disabling the plugin skill alone does not stop a daemon.

## Development

```sh
npm test
claude plugin validate .
claude plugin test .
```

`src/discovery.mjs` isolates the interface signatures and module discovery;
`src/adapter.mjs` validates runtime state; `src/engine.mjs` handles
targeting, stale predictions, leases, and cancellation. Tests cover these behaviors,
persistence, and CLI controls. The original adapter was live-tested with actual
unselected chats: new turns were confirmed while another app remained foreground.
Automated tests use synthetic chats and do not send messages to your account.
The shared Pi/Claude policy is in `integrations/core.mjs`; the two native adapters
are `integrations/pi.mjs` and `hooks/register.mjs`. A checksum test protects the
exact prompt asset.

Changes to supported interface signatures should include read-only adapter checks and
an explicitly authorized live send test. Do not commit state, user chat IDs, logs,
or extracted application bundles.

Packaged using the [official plugin format](https://developers.openai.com/plugins/build/plugins).
MIT licensed.
