import { createStore, sleep } from './store.mjs';
import { connect, install, requireSupported, slot } from './session.mjs';
import { foreground } from './cdp.mjs';

const store = createStore(), token = process.argv[2];
const unlock = store.lock('daemon.lock', token);
let stop = false, cdp, snapshot, lastError, lastStatus = 0;
const ledger = store.read('ledger.json', {}), pending = new Map(), retryAt = new Map();
const enabled = () => !stop && store.read('control.json')?.token === token && store.read('control.json')?.enabled === true;
const call = expression => cdp.evaluate(expression);
const stopRenderer = () => cdp?.evaluate(`if (${slot}?.snapshot().token === ${JSON.stringify(token)}) ${slot}.stop()`).catch(() => {});
process.on('SIGINT', () => { stop = true; void stopRenderer(); });
process.on('SIGTERM', () => { stop = true; void stopRenderer(); });
function record(key, status, data = {}) {
  ledger[key] = { at: new Date().toISOString(), status, ...data };
  store.write('ledger.json', ledger); store.event({ key, ...ledger[key] });
}
function status(phase, error) {
  store.write('status.json', { enabled: enabled(), phase, error, pid: process.pid, updatedAt: Date.now(),
    chats: snapshot?.chats ?? [], sent: Object.values(ledger).filter(j => j.status === 'sent').length });
}
try {
  store.event({ status: 'on' });
  while (enabled()) {
    try {
      const config = store.config();
      if (!cdp) {
        requireSupported(); cdp = await connect(config.port);
        if (!enabled()) break;
        snapshot = await install(cdp, token, config); store.event({ status: 'connected' });
      }
      if (!enabled()) break;
      if (!await call(`${slot}.heartbeat(${JSON.stringify(token)},${JSON.stringify(config)})`)) throw Error('Controller lease was closed');
      snapshot = await call(`${slot}.snapshot()`);
      for (const job of snapshot.jobs) {
        if (!enabled()) break;
        if (job.status === 'ready' && !ledger[job.key] && Date.now() - job.readyAt >= 2000) {
          const before = foreground();
          // Re-read user settings immediately before reserving and submitting.
          const latest = store.config();
          if (!enabled() || latest.exclude.includes(job.id) || (latest.mode !== 'all' && !latest.threads.includes(job.id))) continue;
          await call(`${slot}.configure(${JSON.stringify(latest)})`);
          record(job.key, 'reserved', { threadId: job.id, sourceTurnId: job.turnId });
          const result = await call(`${slot}.send(${JSON.stringify(job.key)},${JSON.stringify(token)})`);
          if (result.status === 'sending') pending.set(job.key, before);
          else record(job.key, 'cancelled', { reason: result.reason });
        } else if (pending.has(job.key) && ['sent', 'unconfirmed', 'send-error', 'cancelled'].includes(job.status)) {
          if (job.status === 'unconfirmed' && Date.now() - job.startedAt < 30000) {
            await call(`${slot}.verify(${JSON.stringify(job.key)})`); continue;
          }
          const before = pending.get(job.key), after = foreground();
          record(job.key, job.status, { threadId: job.id, evidence: job.evidence, error: job.error,
            foregroundBefore: before.name, foregroundAfter: after.name, foregroundUnchanged: before.pid === after.pid,
            selectionUnchanged: job.before?.selected === job.after?.selected,
            rendererUnfocused: job.before?.focused === false && job.after?.focused === false });
          pending.delete(job.key);
        } else if (['abstained', 'stale', 'cancelled'].includes(job.status) && !ledger[job.key]) {
          record(job.key, job.status);
        } else if (job.status === 'prediction-error') {
          if (!retryAt.has(job.key)) { store.event({ status: job.status, error: job.error }); retryAt.set(job.key, Date.now() + 60000); }
          if (Date.now() >= retryAt.get(job.key)) { await call(`${slot}.forget(${JSON.stringify(job.key)})`); retryAt.delete(job.key); }
        }
      }
      let room = 3 - snapshot.jobs.filter(j => j.status === 'predicting').length;
      const jobs = new Set(snapshot.jobs.map(j => j.key));
      for (const chat of snapshot.chats) {
        if (!enabled() || room <= 0) break;
        const key = `${chat.hostId}/${chat.id}/${chat.turnId}`;
        if (!chat.targeted || !chat.turnId || !chat.active || chat.excluded || chat.busy || chat.status !== 'completed' ||
          chat.requests || chat.queued || chat.goalActive || chat.hasDraft || ledger[key] || jobs.has(key)) continue;
        await call(`${slot}.request(${JSON.stringify(chat)})`); room--;
      }
      for (const job of snapshot.jobs) if (ledger[job.key] && !pending.has(job.key) &&
        !['predicting', 'sending'].includes(job.status)) await call(`${slot}.forget(${JSON.stringify(job.key)})`);
      lastError = null;
      if (Date.now() - lastStatus > 2000) { status('watching'); lastStatus = Date.now(); }
    } catch (e) {
      const message = e.message ?? String(e);
      if (lastError !== message) store.event({ status: 'waiting', error: message });
      lastError = message; status('waiting', message);
      await stopRenderer(); cdp?.close(); cdp = null;
      await sleep(4000);
    }
    await sleep(750);
  }
} catch (e) { store.event({ status: 'fatal', error: String(e) }); process.exitCode = 1; }
finally { stop = true; await stopRenderer(); cdp?.close(); status('off'); store.event({ status: 'off' }); unlock(); }
