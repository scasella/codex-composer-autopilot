---
name: composer-autopilot
description: Enable, stop, inspect, or target the local Composer Autopilot controller for Codex desktop predictions. Use when the user wants predictions automatically sent across all active chats or selected threads, or wants exclusions. Requires macOS and a supported desktop build.
---

Run the packaged CLI with Node. Resolve `../../bin/autopilot.mjs` relative to this
SKILL.md's directory; use its absolute path, including when installed in the plugin
cache. No dependency installation is needed.

- `node <cli> doctor`: read-only compatibility and connection check.
- `node <cli> threads --json`: list active local chats with IDs and titles.
- `node <cli> status --json`: inspect the saved selection and controller health.
- `node <cli> on --all --exclude-current`: enable all active chats except this control chat.
- `node <cli> on --thread UUID --thread UUID`: replace the target list with specific chats.
- `node <cli> exclude UUID` / `include UUID`: update persistent exclusions or selection.
- `node <cli> off`: stop future submissions, leaving already-running turns alone.

Enable sending only when the user requests it. Resolve named chats against the
thread listing; ask only if names are ambiguous or the requested target scope is
missing. Preserve existing exclusions. Unless the user explicitly targets this
control chat, exclude its ID to avoid self-follow-up loops. `--exclude-current`
uses CODEX_THREAD_ID; if unavailable, resolve the current chat's actual ID and pass
`--exclude UUID`. Never guess an ID or broaden a selection to all chats.

For initial setup, explain that enabling sends exact model-generated predictions
as user messages, potentially starting further work and using account quota.
The adapter is an unofficial, version-pinned local integration. It does not change
the chats' approval settings or answer pending permission requests.

If the debugging connection is absent, `node <cli> launch` opens the app in the
background with a loopback debugging port. An already-running app must be quit
before new launch flags take effect. Never quit or restart it without the user's
authorization. Unsupported builds stop without sending; do not bypass the check.

After a change, inspect status and report the actual selection and whether it is
watching or waiting. A running process is not proof of a successful send: consult
the local event log named by `status --json` for verified message/turn receipts.
Keep logs, chat content, and state outside the plugin repository. To remove the
plugin, stop the controller first; uninstalling files alone does not stop a daemon.
