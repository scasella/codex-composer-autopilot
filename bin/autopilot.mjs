#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createStore, validate, alive, sleep } from '../src/store.mjs';
import { connect, inspect, appInfo, requireSupported, slot, supportedVersion } from '../src/session.mjs';

const help = `Composer Autopilot — background predictions for Codex desktop

  autopilot doctor                 Check app compatibility and local connection
  autopilot launch                 Open Codex with loopback debugging (never quits it)
  autopilot threads                List active thread IDs and titles
  autopilot on --all               Target all active local chats
  autopilot on --thread UUID       Target specific chats; repeat --thread for more
  autopilot on                     Resume the saved selection
  autopilot exclude UUID          Exclude a chat, persistently
  autopilot include UUID          Remove exclusion; add to selection in selected mode
  autopilot off                    Stop future submissions
  autopilot status                 Show state and saved selection

Options: --exclude UUID (repeatable with on), --exclude-current (on), --port 9222,
         --json (status/threads/doctor). Nothing starts merely by installing.
Requires macOS, Node >=22.4, Codex ${supportedVersion}.`;
const store = createStore();
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  all: { type: 'boolean' }, thread: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true },
  'exclude-current': { type: 'boolean' }, port: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
} });
const [command = 'status', id, ...extra] = positionals;
const output = (data, text) => console.log(values.json ? JSON.stringify(data, null, 2) : text);
function currentStatus() {
  const lock = store.read('daemon.lock'), control = store.read('control.json'), state = store.read('status.json', {});
  const running = !!(lock && alive(lock.pid) && control?.enabled && lock.token === control.token);
  const fresh = running && state.pid === lock.pid && Date.now() - state.updatedAt < 15000;
  return { enabled: running, phase: !running ? 'off' : fresh ? state.phase : 'starting-or-unresponsive',
    error: fresh ? state.error : undefined, config: store.config(),
    monitoredChats: fresh ? state.chats.filter(c => c.targeted && !c.excluded).length : 0,
    verifiedSends: state.sent ?? 0, stateDirectory: store.dir };
}
function report() {
  const s = currentStatus();
  output(s, `Composer Autopilot: ${s.enabled ? 'ON' : 'OFF'} — ${s.phase}\n` +
    `Targets: ${s.config.mode === 'all' ? 'all active local chats' : s.config.threads.join(', ') || 'none'}\n` +
    `Excluded: ${s.config.exclude.join(', ') || 'none'}\n` +
    `${s.monitoredChats} monitored chats; ${s.verifiedSends} verified sends.` + (s.error ? `\n${s.error}` : ''));
}
async function withRenderer(fn) {
  const cdp = await connect(Number(values.port ?? store.config().port));
  try { return await fn(cdp); } finally { cdp.close(); }
}
try {
  if (values.help || command === 'help') { console.log(help); process.exit(0); }
  if (extra.length || (id && !['include', 'exclude'].includes(command))) throw Error('Unexpected argument. Use --help.');
  if ((values.all || values.thread || values.exclude || values['exclude-current']) && command !== 'on') throw Error('Target options belong to the on command.');
  if (command === 'status') report();
  else if (command === 'threads') {
    requireSupported();
    const result = await withRenderer(inspect);
    output(result.chats, result.chats.filter(c => !c.excluded).map(c =>
      `${c.id}  ${c.status ?? 'loading'}${c.hasDraft ? ' (draft)' : ''}  ${c.title ?? '(untitled)'}`).join('\n') || 'No active local chats.');
  } else if (command === 'doctor') {
    const info = appInfo(); let connection;
    try { const s = await withRenderer(inspect); connection = { ok: true, activeChats: s.chats.filter(c => !c.excluded).length }; }
    catch (e) { connection = { ok: false, error: e.message }; }
    output({ ...info, connection }, `Codex ${info.version}: ${info.supported ? 'supported' : 'unsupported'}\n` +
      (connection.ok ? `Local renderer reachable; ${connection.activeChats} active chats.` : `Renderer unavailable: ${connection.error}\nUse launch after quitting Codex when convenient.`));
    if (!info.supported || !connection.ok) process.exitCode = 1;
  } else if (command === 'launch') {
    const { app } = requireSupported(); const port = Number(values.port ?? store.config().port);
    validate({ ...store.config(), port });
    execFileSync('/usr/bin/open', ['-g', '-a', app, '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]);
    console.log(`Background launch requested on 127.0.0.1:${port}. Run doctor to check. An already-running app must be quit manually before launch flags can change.`);
  } else if (['on', 'off', 'exclude', 'include'].includes(command)) {
    const release = store.lock('command.lock', randomUUID());
    try {
      if (command === 'off') {
        const control = store.read('control.json', {});
        store.write('control.json', { ...control, enabled: false });
        try { await withRenderer(c => c.evaluate(`if (${slot}?.snapshot().token === ${JSON.stringify(control.token ?? '')}) ${slot}.stop()`)); }
        catch { /* Durable OFF is also checked by the daemon before each send. */ }
        console.log('Composer Autopilot: OFF. Already-submitted turns keep running.');
      } else if (command === 'include' || command === 'exclude') {
        if (!id) throw Error('Provide a full thread UUID.');
        const config = store.config();
        if (command === 'exclude') config.exclude.push(id);
        else { config.exclude = config.exclude.filter(x => x !== id); if (config.mode === 'selected') config.threads.push(id); }
        store.write('config.json', validate(config)); report();
      } else {
        if (values.all && values.thread) throw Error('Choose --all or --thread, not both.');
        const config = store.config();
        if (values.all) { config.mode = 'all'; config.threads = []; }
        if (values.thread) { config.mode = 'selected'; config.threads = values.thread; }
        config.exclude.push(...values.exclude ?? []);
        if (values['exclude-current']) {
          if (!process.env.CODEX_THREAD_ID) throw Error('CODEX_THREAD_ID is unavailable; use --exclude UUID.');
          config.exclude.push(process.env.CODEX_THREAD_ID);
        }
        config.port = Number(values.port ?? config.port);
        validate(config);
        if (config.mode === 'selected' && !config.threads.length) throw Error('Choose --all or at least one --thread UUID.');
        requireSupported();
        const existing = store.read('daemon.lock');
        if (existing && alive(existing.pid)) {
          if (!store.read('control.json')?.enabled) throw Error('Controller is stopping; retry in a moment.');
          if (config.port !== store.config().port) throw Error('Turn off before changing the debugging port.');
          store.write('config.json', validate(config)); await sleep(1000); report();
        } else {
          await withRenderer(async c => {
            const busy = await c.evaluate(`${slot}?.snapshot().enabled ?? false`);
            if (busy) throw Error('Another Composer Autopilot controller is active. Turn it off first.');
          });
          const token = randomUUID(); store.write('config.json', validate(config));
          store.write('control.json', { enabled: true, token });
          const fd = fs.openSync(store.file('daemon.log'), 'a', 0o600);
          const child = spawn(process.execPath, [fileURLToPath(new URL('../src/daemon.mjs', import.meta.url)), token],
            { detached: true, stdio: ['ignore', fd, fd], cwd: path.dirname(fileURLToPath(import.meta.url)) });
          child.unref(); fs.closeSync(fd);
          await sleep(1600); report();
          if (currentStatus().phase !== 'watching') process.exitCode = 1;
        }
      }
    } finally { release(); }
  } else throw Error('Unknown command. Use --help.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
