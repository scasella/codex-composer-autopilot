// Serialized into the renderer; discovery supplies only verified bindings.
export async function createAdapter(b) {
  const fail = detail => { throw Error(`Renderer interface incompatible: ${detail}`); };
  const check = (condition, detail) => { if (!condition) fail(detail); };
  const boolean = (value, role) => { check(typeof value === 'boolean', role); return value; };
  const scope = b.scope;
  const roots = [...scope.chain.values()].filter(n => n.token.__scopeBrand === 'AppScope');
  check(roots.length === 1, 'app scope');
  const root = roots[0];
  const required = ['getHostId', 'getCachedConversations', 'getConversation', 'getTurnCoordinator',
    'isConversationSuppressedAfterArchive', 'hydrateBackgroundThreads'];
  const interfaces = new Map();
  function health() {
    check(typeof b.service.requestUserMessagePrediction === 'function', 'prediction service changed');
    for (const [object, methods] of interfaces) for (const name of methods)
      check(typeof object[name] === 'function', `${name} changed`);
    check(root.retainedScopeEntries instanceof Map, 'scope tree');
  }
  function managers() {
    health();
    const list = scope.get(b.managers);
    check(Array.isArray(list), 'manager list');
    for (const mgr of list) {
      check(required.every(name => typeof mgr[name] === 'function'), 'manager methods');
      if (!interfaces.has(mgr)) interfaces.set(mgr, required);
    }
    return list.filter(x => x.getHostId() === 'local');
  }
  const manager = host => managers().find(x => x.getHostId() === host);
  const tracked = new Set(), refreshing = new Set(), refreshedAt = new Map();
  function track(mgr, c) {
    const key = `${mgr.getHostId()}/${c.id}`;
    if (c.resumeState === 'resumed' || boolean(b.busy(c), 'busy state')) tracked.add(key);
    return tracked.has(key);
  }
  function refresh() {
    for (const mgr of managers()) for (const c of mgr.getCachedConversations()) {
      if (track(mgr, c)) {
        const queue = mgr.getTurnCoordinator();
        check(typeof queue.loadMessages === 'function', 'queue loader');
        if (queue.readMessages(c.id) === undefined) void queue.loadMessages(c.id).catch(() => {});
      }
      if (!track(mgr, c) || c.resumeState !== 'needs_resume' || c.ephemeral || c.sideConversation || c.parentThreadId) continue;
      const key = `${mgr.getHostId()}/${c.id}`;
      if (refreshing.has(key) || Date.now() - (refreshedAt.get(key) ?? 0) < 10000) continue;
      refreshing.add(key); refreshedAt.set(key, Date.now());
      // Read background history for a running chat even if it has never been selected in this window.
      mgr.hydrateBackgroundThreads([c.id], { includeTurns: true, maxTurns: 2, refreshExisting: true })
        .catch(() => {}).finally(() => refreshing.delete(key));
    }
  }
  function drafts(id) {
    if (boolean(b.persistedDraft(scope, 'local:' + id), 'persisted draft')) return true;
    let found = false;
    function walk(parent, node) {
      check(node.retainedScopeEntries instanceof Map, 'retained scopes');
      for (const [type, entries] of node.retainedScopeEntries) {
        for (const [key] of entries) {
          const child = b.retained(parent, type, key);
          check(child?.node && child.value, 'retained scope unavailable');
          if (type.__scopeBrand === 'ThreadScope' && child.value.routeConversationId === id &&
            boolean(b.persistedDraft(scope, child.value.clientThreadId), 'thread draft')) found = true;
          if (type.__scopeBrand === 'ComposerScope' && child.value.kind === 'local' &&
            child.value.conversationId === id && boolean(b.composerDraft(child), 'composer draft')) found = true;
          walk(child, child.node);
        }
      }
    }
    walk(scope, root);
    return found;
  }
  function summarize(mgr, c) {
    check(typeof c.id === 'string' && Array.isArray(c.requests) && Array.isArray(c.turns), 'conversation fields');
    check(['resumed', 'needs_resume', 'resuming'].includes(c.resumeState), 'resume state');
    const turn = b.latest(c);
    check(turn == null || (typeof turn.turnId === 'string' && ['completed', 'inProgress', 'failed', 'interrupted'].includes(turn.status) && Array.isArray(turn.items)), 'latest turn');
    const coordinator = mgr.getTurnCoordinator();
    check(typeof coordinator?.readMessages === 'function' && typeof coordinator.loadMessages === 'function', 'queue interface');
    if (!interfaces.has(coordinator)) interfaces.set(coordinator, ['readMessages', 'loadMessages']);
    const queued = coordinator.readMessages(c.id);
    check(queued === undefined || Array.isArray(queued), 'message queue');
    return { hostId: mgr.getHostId(), id: c.id, title: c.title, turnId: turn?.turnId,
      status: turn?.status, active: track(mgr, c), busy: boolean(b.busy(c), 'busy state'),
      excluded: !!(c.ephemeral || c.sideConversation || c.parentThreadId || c.archived || c.archivedAt ||
        boolean(mgr.isConversationSuppressedAfterArchive(c.id), 'archive state') ||
        c.latestCollaborationMode?.mode === 'plan' || boolean(scope.get(b.excluded, c.id), 'continuation state')),
      requests: c.requests.length, queued: queued === undefined ? 1 : queued.length,
      goalActive: c.threadGoal?.status === 'active', hasDraft: drafts(c.id) };
  }
  const api = {
    health, refresh,
    list: () => managers().flatMap(mgr => mgr.getCachedConversations()
      .filter(c => track(mgr, c)).map(c => summarize(mgr, c))),
    get: (host, id) => { const mgr = manager(host), c = mgr?.getConversation(id); return c && summarize(mgr, c); },
    ui: () => ({ focused: document.hasFocus(),
      selected: document.querySelector('[data-app-action-sidebar-thread-selected="true"]')
        ?.getAttribute('data-app-action-sidebar-thread-id') ?? null }),
    async predict(c) {
      health();
      const prediction = await b.service.requestUserMessagePrediction({ hostId: c.hostId,
        threadId: c.id, latestTurnId: c.turnId, generationTrigger: 'catch_up' });
      check(prediction && (prediction.text === null || typeof prediction.text === 'string') &&
        typeof prediction.sourceTurnId === 'string', 'prediction response');
      return prediction;
    },
    // The same app helper used for ordinary follow-ups; preserves model and permission settings.
    send: (job, prompt) => { health(); return b.send(scope, job.hostId, job.id, { prompt }); },
    verify(job, text) {
      const c = manager(job.hostId)?.getConversation(job.id), turn = c && b.latest(c);
      if (!turn || turn.turnId === job.turnId) return null;
      const user = turn.items?.find(x => x.type === 'userMessage' &&
        (x.content?.filter(y => y.type === 'text').map(y => y.text).join('').trim() === text.trim() || x.text === text));
      return user ? { turnId: turn.turnId, userMessageId: user.id } : null;
    }
  };
  return api;
}
