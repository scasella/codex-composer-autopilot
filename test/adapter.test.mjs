import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../src/adapter.mjs';
import { createEngine } from '../src/engine.mjs';
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const root = { token: { __scopeBrand: 'AppScope' }, retainedScopeEntries: new Map() };
  const chat = { id: 'chat', requests: [], turns: [], resumeState: 'resumed' };
  const turn = { turnId: 'turn', status: 'completed', items: [] };
  const queue = { readMessages: () => [], loadMessages: async () => {} };
  const manager = { getHostId: () => 'local', getCachedConversations: () => [chat],
    getConversation: () => chat, getTurnCoordinator: () => queue,
    isConversationSuppressedAfterArchive: () => false, hydrateBackgroundThreads: async () => {} };
  const sent = [];
  const bindings = { managers: {}, excluded: {}, busy: () => false, latest: () => turn,
    persistedDraft: () => false, composerDraft: () => false, retained: () => null,
    send: async (...args) => { sent.push(args); },
    service: { requestUserMessagePrediction: async () => ({ text: 'Continue', sourceTurnId: 'turn' }) } };
  bindings.scope = { chain: new Map([['root', root]]), get: atom => atom === bindings.managers ? [manager] : false };
  return { bindings, chat, turn, queue, manager, root, sent };
}
test('unknown queue blocks eligibility until loaded', async () => {
  const f = fixture(), api = await createAdapter(f.bindings);
  f.queue.readMessages = () => undefined;
  assert.equal(api.list()[0].queued, 1);
  f.queue.readMessages = () => [];
  assert.equal(api.list()[0].queued, 0);
});
for (const [name, mutate] of Object.entries({
  requests: f => { delete f.chat.requests; },
  queue: f => { f.queue.readMessages = () => ({}); },
  draft: f => { f.bindings.persistedDraft = () => undefined; },
  busy: f => { f.bindings.busy = () => undefined; },
  turn: f => { f.turn.status = 'unknown'; },
  scope: f => { f.root.retainedScopeEntries = null; },
  manager: f => { f.manager.getConversation = null; }
})) {
  test(`fails closed on malformed ${name}`, async () => {
    const f = fixture(), api = await createAdapter(f.bindings);
    api.list(); mutate(f);
    assert.throws(() => api.list(), /Renderer interface incompatible/);
  });
}
test('malformed prediction responses never reach send', async () => {
  for (const response of [undefined, {}, { text: 5, sourceTurnId: 'turn' }, { text: 'Continue' }]) {
    const f = fixture(); f.bindings.service.requestUserMessagePrediction = async () => response;
    const api = await createAdapter(f.bindings);
    await assert.rejects(api.predict(api.list()[0]), /prediction response/);
    assert.equal(f.sent.length, 0);
  }
});
test('interface loss after a ready prediction latches engine OFF and remains inspectable', async () => {
  const f = fixture(), api = await createAdapter(f.bindings);
  api.ui = () => ({ focused: false, selected: 'other' });
  const engine = createEngine(api, 'owner');
  engine.configure({ mode: 'all', threads: [], exclude: [] });
  engine.request(api.list()[0]); await settle();
  f.bindings.persistedDraft = () => undefined;
  assert.throws(() => engine.send('local/chat/turn', 'owner'), /Renderer interface incompatible/);
  assert.equal(engine.snapshot().enabled, false);
  assert.match(engine.snapshot().fault, /persisted draft/);
  f.bindings.persistedDraft = () => false;
  assert.equal(engine.heartbeat('owner'), false);
  assert.equal(engine.send('local/chat/turn', 'owner').status, 'blocked');
  assert.equal(engine.stop().enabled, false);
  assert.equal(f.sent.length, 0);
});
test('async prediction contract failure disables the controller', async () => {
  const f = fixture(); f.bindings.service.requestUserMessagePrediction = async () => ({ text: 'Continue' });
  const api = await createAdapter(f.bindings); api.ui = () => ({});
  const engine = createEngine(api, 'owner'); engine.configure({ mode:'all',threads:[],exclude:[] });
  engine.request(api.list()[0]); await settle();
  assert.equal(engine.snapshot().enabled, false);
  assert.match(engine.snapshot().fault, /prediction response/);
  assert.equal(f.sent.length, 0);
});
test('interface loss in the final submission microtask cancels sending', async () => {
  const f = fixture(), api = await createAdapter(f.bindings); api.ui = () => ({});
  const engine = createEngine(api, 'owner'); engine.configure({ mode:'all',threads:[],exclude:[] });
  engine.request(api.list()[0]); await settle();
  assert.equal(engine.send('local/chat/turn', 'owner').status, 'sending');
  f.queue.readMessages = () => 'changed';
  await settle();
  assert.equal(engine.snapshot().enabled, false);
  assert.match(engine.snapshot().fault, /message queue/);
  assert.equal(f.sent.length, 0);
});
