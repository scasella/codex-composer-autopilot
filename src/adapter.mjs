// Pinned to Codex 26.1007.30912. Missing exports fail closed after an app update.
export async function createAdapter() {
  const m = await import('/assets/app-shared-8bd9d0399038.js');
  const i = await import('/assets/app-initial-6350d04672d0.js');
  const scope = m.mQt.scope;
  const root = [...scope.chain.values()].find(n => n.token.__scopeBrand === 'AppScope');
  if (!root || !m.fN?.cumberbatch || typeof i.Dgt !== 'function' || typeof i.h2t !== 'function')
    throw new Error('Installed Codex build is not supported');
  const managers = () => scope.get(m.ON).filter(x => x.getHostId() === 'local');
  const manager = host => managers().find(x => x.getHostId() === host);
  const tracked = new Set(), refreshing = new Set(), refreshedAt = new Map();
  function track(mgr, c) {
    const key = `${mgr.getHostId()}/${c.id}`;
    if (c.resumeState === 'resumed' || m.xUt(c)) tracked.add(key);
    return tracked.has(key);
  }
  function refresh() {
    for (const mgr of managers()) for (const c of mgr.getCachedConversations()) {
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
    if (i.g2t(scope, 'local:' + id)) return true;
    let found = false;
    function walk(parent, node) {
      for (const [type, entries] of node.retainedScopeEntries) {
        for (const [key] of entries) {
          const child = m.fon(parent, type, key);
          if (!child) continue;
          if (type.__scopeBrand === 'ThreadScope' && child.value.routeConversationId === id &&
            i.g2t(scope, child.value.clientThreadId)) found = true;
          if (type.__scopeBrand === 'ComposerScope' && child.value.kind === 'local' &&
            child.value.conversationId === id && i.h2t(child)) found = true;
          walk(child, child.node);
        }
      }
    }
    walk(scope, root);
    return found;
  }
  function summarize(mgr, c) {
    const turn = m.Bgt(c);
    const queued = mgr.getTurnCoordinator().readMessages(c.id);
    return { hostId: mgr.getHostId(), id: c.id, title: c.title, turnId: turn?.turnId,
      status: turn?.status, active: track(mgr, c), busy: m.xUt(c),
      excluded: !!(c.ephemeral || c.sideConversation || c.parentThreadId || c.archived || c.archivedAt ||
        mgr.isConversationSuppressedAfterArchive(c.id) ||
        c.latestCollaborationMode?.mode === 'plan' || scope.get(m.TG, c.id)),
      requests: c.requests?.length ?? 0, queued: queued?.length ?? 0,
      goalActive: c.threadGoal?.status === 'active', hasDraft: drafts(c.id) };
  }
  const api = {
    refresh,
    list: () => managers().flatMap(mgr => mgr.getCachedConversations()
      .filter(c => track(mgr, c)).map(c => summarize(mgr, c))),
    get: (host, id) => { const mgr = manager(host), c = mgr?.getConversation(id); return c && summarize(mgr, c); },
    ui: () => ({ focused: document.hasFocus(),
      selected: document.querySelector('[data-app-action-sidebar-thread-selected="true"]')
        ?.getAttribute('data-app-action-sidebar-thread-id') ?? null }),
    predict: c => m.fN.cumberbatch.requestUserMessagePrediction({ hostId: c.hostId,
      threadId: c.id, latestTurnId: c.turnId, generationTrigger: 'catch_up' }),
    // The same app helper used for ordinary follow-ups; preserves model and permission settings.
    send: (job, prompt) => i.Dgt(scope, job.hostId, job.id, { prompt }),
    verify(job, text) {
      const c = manager(job.hostId)?.getConversation(job.id), turn = c && m.Bgt(c);
      if (!turn || turn.turnId === job.turnId) return null;
      const user = turn.items?.find(x => x.type === 'userMessage' &&
        (x.content?.filter(y => y.type === 'text').map(y => y.text).join('').trim() === text.trim() || x.text === text));
      return user ? { turnId: turn.turnId, userMessageId: user.id } : null;
    }
  };
  return api;
}
