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

The native extension defaults to your coding model and supports a separate
Composer model through your configured providers and credentials. Tested with Pi
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
| `/composer models` | List Pi models with configured credentials, or Claude aliases and ID guidance |
| `/composer model MODEL` | Choose a separate model for predictions |
| `/composer model session` | Follow the current coding model (default) |
| `/composer model` | Show the saved Composer model and status |
| `/composer effort LEVEL` | Set prediction effort: `low`, `medium`, `high`, `xhigh`, or `max`; `default` resets it |
| `/composer effort` | Show the saved Composer effort and status |
| `/composer suggestions N` | Request up to 1–10 candidates in suggestion mode (default 1) |
| `/composer suggestions` | Show the saved count and status |
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
The first settings change writes config version 5, which older plugins reject
rather than ignoring the selected delivery mode, Composer model, effort, or suggestion count. Pi: `pi update git:github.com/scasella/codex-composer-autopilot` then `/reload`.
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

### Browse multiple suggestions

```text
/composer suggestions 3
```

In suggestion mode, this requests **up to N distinct candidates in one model
call**, using the saved Composer model and effort. The range is 1–10; the default
is 1. The model may return fewer candidates or abstain. Duplicate candidates are
removed. No extra calls are made to fill the count. More candidates may use more
output tokens. The count persists across targeted sessions in this harness.

- **Pi:** while the preview is visible and the editor is empty, use **↑/↓** to
  cycle candidates (wrapping at either end), then **Tab** to copy the selected
  candidate into the draft. **Enter** sends only after acceptance. Arrows keep
  their normal behavior when there is no multi-candidate preview.
- **Claude Code:** the first candidate appears as native ghost text, with a
  native picker above the prompt when there are alternatives. Press **Ctrl+X,
  then Tab** (the default band-focus binding), or click the picker. Use **↑/↓**
  to browse and **Enter** to choose; then **Esc** returns to the prompt and
  **Tab** accepts the chosen ghost text. A subsequent **Enter** sends. Claude's
  native ghost-text API accepts one string and has no candidate-cycling API;
  arrows in the prompt retain their normal history behavior. The picker uses
  the native terminal/desktop above-prompt surface and never takes focus itself.

Typing, starting a turn, or changing Composer settings discards pending work and
invalidates the picker. Selection checks the current target settings again, so
OFF in another session prevents picking a retained candidate. An already shown
Claude ghost suggestion may remain until the next edit or turn; it never sends
itself. Candidates stay in memory and are not added to plugin state files.

`/composer suggestions 1` restores the single-preview behavior. **Auto mode always
requests and sends one prediction**, regardless of this setting; it never sends
a batch of alternatives. The setting does not enable Composer, change its scope,
or change delivery mode.

### Choose a Composer model

```text
/composer models
/composer model haiku
```

The example above selects Claude's `haiku` alias. Claude also accepts `sonnet`,
`opus`, and full model IDs that its configured provider and policy allow. This
list is guidance, not an account-specific availability check; the native model
API validates the choice when generating a prediction.

In Pi, use a full **provider/model-id** from `/composer models`:

```text
/composer model PROVIDER/MODEL_ID
```

Pi checks the model registry and configured credentials before saving a choice.
Model IDs containing further slashes are supported. Each prediction uses the
selected provider's normal authentication. A different provider receives the
conversation context used to generate the prediction.

`/composer model session` restores the default of following the coding model.
This setting is shared across targeted sessions within one harness, independent
of the other harness. It persists across restarts and does not change the coding
model, target selection, enabled state, or delivery mode. Changing it discards
pending predictions. If a selected model fails, Composer pauses without falling
back to another model; select a working model to resume on a future turn.

**Claude context:** `session` with `default` effort uses the native conversation
fork. The fork API cannot override model or effort, so an explicit model or
effort uses `model.complete` with
up to 80 recent visible transcript entries, bounded text/tool output, and the
initial user request. It includes the exact Composer prompt unchanged. It does
not receive images, hidden system instructions, or project instructions that are
absent from the visible transcript. Predictions may therefore differ from the
native fork even if the chosen model is the same. This uses the documented
[Claude model APIs](https://code.claude.com/docs/en/plugins/mods/api).

### Choose Composer reasoning effort

```text
/composer effort low
/composer effort
/composer effort default
```

Choose `low`, `medium`, `high`, `xhigh`, or `max`. An explicit choice applies only
to Composer prediction requests, independently of the coding session's effort.
It persists across restarts and applies to targeted sessions within this harness;
it does not change the Composer model, targets, enabled state, or delivery mode.
Changing effort discards pending predictions and invalidates retained Pi previews.
A native Claude preview already displayed may remain until the next edit or turn.

`default` preserves the previous behavior: Pi requests **high** reasoning; Claude
uses the native fork when following the coding model, or the selected model's
own default for a separate completion. To request a specific effort independently
in Claude, set an explicit level; this uses the bounded transcript path described
above, including when `/composer model session` is selected.

Supported effort depends on the chosen model and provider. Pi uses its provider's
normal reasoning mapping; Claude drops effort for models without effort support.
A model error pauses predictions without silently switching models or effort.

### Prompt caching and usage

Caching is automatic; there is no new Composer setting. `/composer status` shows
provider-reported usage for this session's **last prediction request**, for example:

```text
Cache (last prediction): hit; read 4096, wrote 256 tokens
```

A hit means the provider reported cache reads greater than zero. Zero reads show
`no hit reported`; missing usage shows `unavailable`, not a guessed zero. Counters
survive restarts and include requests whose suggestions were later discarded.
They describe the last request, not lifetime totals or a guaranteed cost saving.
Only token counts are persisted, never cached prompt content or response text.

**Claude:** the custom-model/effort path uses native text blocks with cache
breakpoints on the stable header and recent history, followed by uncached window
metadata and prediction instructions. Appending turns preserves earlier text
prefixes; changing the requested number of suggestions affects only the tail.
The context remains bounded to 80 recent entries plus the initial intent. When
that window moves or context is compacted, the changed prefix needs a new cache
write. The native fork retains its own caching and reports the same usage fields.
Block caching requires Claude Code 2.1.292 or later (validated on 2.1.296).

**Pi:** the extension retains native provider caching and its stable Composer
session key. For Anthropic Messages, it moves the provider's existing final cache
marker from prediction instructions onto the preceding reusable conversation
history. It preserves retention/TTL and does nothing when that marker is absent,
so provider cache opt-outs are respected. Other APIs keep their native payloads.
Both cache-read and cache-write token counts use Pi's normalized provider usage.

Actual cache hits depend on provider support, minimum prefix length, matching
model/context and cache expiry. Short conversations may not qualify; a different
Composer model does not share the coding model's cache. No extra model calls,
local prompt cache, dependencies, or automatic retries are added.

### Claude prediction API errors

If Composer pauses with `api-error`, `/composer status` preserves the API's HTTP
status and classified error category (v0.7.1 and later). The plugin does not log
provider response bodies or credentials. A 429 points to rate limiting; 401/403
to authentication or model access; 400/404 to a rejected request or model ID.
A status alone does not identify the exact underlying cause.

After resolving the error, run `/composer on` and complete another coding turn.
To test the native conversation-fork path, use `/composer model session` and
`/composer effort default`, then `/composer on`. This changes only Composer's
prediction settings. Selecting `session` with an explicit effort still uses
`model.complete`, so reset both to test the fork. No automatic fallback is used.

### Prompt and behavior

Both integrations use the byte-exact **Composer prompt version 5** retrieved from
Codex's prediction configuration on October 13, 2026, saved in
[`prompts/composer-v5.txt`](prompts/composer-v5.txt). Its SHA-256 is
`bf64e2c1b0e11dca1a982ab95e77afc4046422b3605849fb9d9da0fdca069418`.
A JSON output constraint is appended separately; the original prompt is unchanged.
For multiple candidates, the appended instruction requests a ranked suggestions
array instead of the single-suggestion object.

Pi sends a separate prediction request with the current conversation and system
prompt to the chosen model, requesting the saved effort (high by default). Claude
uses its native conversation fork by default, or the bounded transcript path
described above when you explicitly select a model or effort. These reuse the prompt, not Codex's private prediction
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
