// Serialized into the renderer. No DOM events, navigation, or focus operations.
export function createEngine(api, token, now = Date.now) {
  let enabled = true, lease = now() + 15000;
  const jobs = new Map();
  let fault = null;
  function trip(error) {
    enabled = false;
    fault = `Renderer interface incompatible: ${String(error)}`;
    for (const job of jobs.values()) if (['predicting', 'ready'].includes(job.status)) job.status = 'cancelled';
    return Error(fault);
  }
  const raw = api;
  api = Object.fromEntries(Object.entries(raw).map(([name, fn]) => [name, (...args) => {
    if (fault) throw Error(fault);
    try { return fn(...args); } catch (e) { throw trip(e); }
  }]));
  let excludedThreads = new Set(), mode = 'selected', selectedThreads = new Set();
  const isExcluded = c => c && excludedThreads.has(c.id);
  const live = () => enabled && now() < lease;
  const keyOf = c => `${c.hostId}/${c.id}/${c.turnId}`;
  function reason(c) {
    if (!live()) return 'off';
    if (!c) return 'missing';
    if (isExcluded(c)) return 'excluded-by-user';
    if (mode !== 'all' && !selectedThreads.has(c.id)) return 'not-targeted';
    if (!c.active || c.excluded) return 'inactive';
    if (c.busy || c.status !== 'completed') return 'busy';
    if (c.requests || c.queued || c.goalActive) return 'pending-request-or-continuation';
    if (c.hasDraft) return 'draft';
    return null;
  }
  const snapshot = () => ({ enabled: live(), token, fault, ui: fault ? null : api.ui(),
    chats: (fault ? [] : api.list()).map(c => ({ ...c, excluded: c.excluded || isExcluded(c), userExcluded: isExcluded(c), targeted: mode === 'all' || selectedThreads.has(c.id) })), jobs: [...jobs.values()].map(({ prediction, ...j }) => ({ ...j,
      predictionThreadId: prediction?.predictionThreadId })) });
  return {
    token,
    configure(config) {
      mode = config.mode; selectedThreads = new Set(config.threads); this.setExclusions(config.exclude);
    },
    setExclusions(ids) {
      excludedThreads = new Set(ids);
      for (const job of jobs.values()) if (isExcluded(job) && ['predicting', 'ready'].includes(job.status)) {
        job.status = 'cancelled'; job.reason = 'excluded-by-user';
      }
    },
    heartbeat(t, config) {
      if (t !== token || !enabled) return false;
      if (config !== undefined) this.configure(config);
      api.health?.(); lease = now() + 15000; api.refresh?.(); return true;
    },
    stop() {
      enabled = false;
      for (const job of jobs.values()) if (['predicting', 'ready'].includes(job.status)) job.status = 'cancelled';
      return { enabled: false, token, fault };
    },
    snapshot,
    request(c) {
      const key = keyOf(c);
      if (jobs.has(key)) return jobs.get(key).status;
      const current = api.get(c.hostId, c.id);
      if (reason(current) || keyOf(current) !== key) return 'blocked';
      const job = { key, hostId: c.hostId, id: c.id, turnId: c.turnId, title: c.title,
        status: 'predicting', createdAt: now() };
      jobs.set(key, job);
      Promise.resolve().then(() => api.predict(c)).then(prediction => {
        if (isExcluded(c) || (mode !== 'all' && !selectedThreads.has(c.id)) || job.status === 'cancelled') { job.status = 'cancelled'; return; }
        if (!live()) { job.status = 'cancelled'; return; }
        if (prediction?.sourceTurnId && prediction.sourceTurnId !== c.turnId) {
          job.status = 'stale'; return;
        }
        job.prediction = prediction;
        job.status = prediction?.text?.trim() ? 'ready' : 'abstained';
        job.readyAt = now();
      }).catch(e => { if (String(e).includes('Renderer interface incompatible:')) trip(e); job.status = 'prediction-error'; job.error = String(e); });
      return job.status;
    },
    send(key, t) {
      const job = jobs.get(key);
      if (t !== token || !live() || job?.status !== 'ready') return { status: 'blocked' };
      const c = api.get(job.hostId, job.id);
      const blocked = reason(c);
      if (blocked || keyOf(c) !== key) {
        // Drafts and requests can clear later; a newer turn permanently invalidates a prediction.
        if (!c || keyOf(c) !== key) job.status = 'stale';
        return { status: 'blocked', reason: blocked ?? 'newer-turn' };
      }
      job.status = 'sending'; job.before = api.ui(); job.startedAt = now();
      // The daemon journals a reservation before this call. Ambiguous sends are never retried.
      Promise.resolve().then(() => {
        if (!live()) { job.status = 'cancelled'; return; }
        const c = api.get(job.hostId, job.id);
        if (reason(c) || keyOf(c) !== key) { job.status = 'cancelled'; return; }
        return api.send(job, job.prediction.text).then(() => {
          job.after = api.ui(); job.completedAt = now();
          const evidence = api.verify(job, job.prediction.text);
          job.status = evidence ? 'sent' : 'unconfirmed'; job.evidence = evidence;
        });
      }).catch(e => { if (String(e).includes('Renderer interface incompatible:')) trip(e); job.status = 'send-error'; job.error = String(e); });
      return { status: job.status, before: job.before };
    },
    verify(key) {
      const job = jobs.get(key);
      if (job?.status === 'unconfirmed') {
        const evidence = api.verify(job, job.prediction.text);
        if (evidence) { job.status = 'sent'; job.evidence = evidence; job.after = api.ui(); }
      }
    },
    forget(key) { const j = jobs.get(key); if (j && !['predicting', 'sending'].includes(j.status)) jobs.delete(key); }
  };
}
