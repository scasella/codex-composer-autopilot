# Composer Autopilot

Automatically send Composer predictions in **all active Codex chats or just the
threads you choose**, without switching chats or taking foreground focus.

One plugin skill. One small Node controller. **Zero npm dependencies, no build step,
no MCP server, no telemetry.** Off until you explicitly enable it.

**Experimental:** this uses a private desktop renderer interface. The current
adapter supports **macOS and Codex desktop 26.1007.30912** only, with Node **22.4+**.
Other app builds stop without sending. This is not an official OpenAI feature.

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

## Run directly

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

## Behavior

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

## Local state and troubleshooting

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
```

`src/adapter.mjs` is the only build-specific integration; `src/engine.mjs` handles
targeting, stale predictions, leases, and cancellation. Tests cover these behaviors,
persistence, and CLI controls. The original adapter was live-tested with actual
unselected chats: new turns were confirmed while another app remained foreground.
Automated tests use synthetic chats and do not send messages to your account.

Contributions for other desktop builds should include read-only adapter checks and
an explicitly authorized live send test. Do not commit state, user chat IDs, logs,
or extracted application bundles.

Packaged using the [official plugin format](https://developers.openai.com/plugins/build/plugins).
MIT licensed.
