---
name: composer-autopilot
description: Enable, stop, inspect, or target the local Composer Autopilot controller for Codex desktop predictions. Use when the user wants predictions automatically sent across all active chats or selected threads, or wants exclusions. Requires macOS and a compatible renderer interface.
---

This skill controls Codex desktop only. In Pi or Claude Code, use the native
`/composer on [here|all|SESSION_ID ...]`, `/composer off`, `/composer off here`,
`/composer status`, and `/composer sessions` commands documented in the package
README. Do not start the Codex desktop controller to manage Pi or Claude sessions.

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
The adapter is an unofficial local integration with runtime interface checks. It does not change
the chats' approval settings or answer pending permission requests.

If the debugging connection is absent, `node <cli> launch` opens the app in the
background with a loopback debugging port. An already-running app must be quit
before new launch flags take effect. Never quit or restart it without the user's
authorization. Incompatible interfaces disable sending; never bypass the checks. After a plugin
update, run doctor and explicitly enable again only within the user’s authorized scope.

After a change, inspect status and report the actual selection and whether it is
watching or waiting. A running process is not proof of a successful send: consult
the local event log named by `status --json` for verified message/turn receipts.
Keep logs, chat content, and state outside the plugin repository. To remove the
plugin, stop the controller first; uninstalling files alone does not stop a daemon.
