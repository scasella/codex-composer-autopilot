import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  let time = 100, resolvePrediction;
  const chats = [
    { hostId: 'local', id: 'selected', turnId: 'a', title: 'Selected', active: true, status: 'inProgress', busy: true },
    { hostId: 'local', id: 'background', turnId: 'b', title: 'Background', active: true, status: 'completed', ...overrides }
  ];
  const sent = [], predictions = [];
  const ui = { focused: false, selected: 'selected' };
  const engine = createEngine({
    list: () => chats, get: (h, id) => chats.find(c => c.id === id && c.hostId === h), ui: () => ({ ...ui }),
    predict: c => { predictions.push(c.id); return new Promise(r => { resolvePrediction = r; }); },
    send: async (j, text) => { sent.push({ id: j.id, text }); chats.find(c => c.id === j.id).turnId = 'sent-turn'; },
    verify: () => sent.length ? { turnId: 'sent-turn', userMessageId: 'user-id' } : null
  }, 'token', () => time);
  engine.configure({mode:'all',threads:[],exclude:[]});
  return { engine, chats, sent, predictions, ui, advance: ms => { time += ms; },
    resolve: p => resolvePrediction(p), key: 'local/background/b',
    async ready() { engine.request(chats[1]); await settle(); resolvePrediction({ text: 'Exact prediction', sourceTurnId: 'b' }); await settle(); }
  };
}
test('sends the exact prediction to an unselected chat, preserving selection and focus', async () => {
  const f = fixture(); await f.ready(); f.engine.send(f.key, 'token'); await settle();
  assert.deepEqual(f.sent, [{ id: 'background', text: 'Exact prediction' }]);
  const j = f.engine.snapshot().jobs[0]; assert.equal(j.status, 'sent'); assert.deepEqual(j.before, j.after);
});
for (const [field, value] of Object.entries({ busy: true, hasDraft: true, requests: 1, queued: 1,
  goalActive: true, excluded: true, active: false, status: 'interrupted' })) {
  test(`does not request or send when ${field}=${value}`, async () => {
    const f = fixture({ [field]: value }); assert.equal(f.engine.request(f.chats[1]), 'blocked');
    await settle(); assert.equal(f.predictions.length, 0); assert.equal(f.sent.length, 0);
  });
}
test('rechecks a draft that appears after prediction generation', async () => {
  const f = fixture(); await f.ready(); f.chats[1].hasDraft = true;
  assert.equal(f.engine.send(f.key, 'token').reason, 'draft'); assert.equal(f.sent.length, 0);
});
test('rechecks a turn started by the user after prediction generation', async () => {
  const f = fixture(); await f.ready(); f.chats[1].turnId = 'new';
  assert.equal(f.engine.send(f.key, 'token').status, 'blocked'); assert.equal(f.sent.length, 0);
});
test('rejects a cached prediction belonging to a different turn', async () => {
  const f = fixture(); f.engine.request(f.chats[1]); await settle(); f.resolve({ text: 'Wrong', sourceTurnId: 'old' });
  await settle(); assert.equal(f.engine.snapshot().jobs[0].status, 'stale');
});
test('OFF while prediction is pending prevents later submission', async () => {
  const f = fixture(); f.engine.request(f.chats[1]); await settle(); f.engine.stop();
  f.resolve({ text: 'Too late' }); await settle(); f.engine.send(f.key, 'token');
  assert.equal(f.sent.length, 0); assert.equal(f.engine.snapshot().jobs[0].status, 'cancelled');
});
test('OFF immediately after send is scheduled prevents invocation', async () => {
  const f = fixture(); await f.ready(); f.engine.send(f.key, 'token'); f.engine.stop(); await settle();
  assert.equal(f.sent.length, 0);
});
test('expired daemon lease cannot send or be revived by a different token', async () => {
  const f = fixture(); await f.ready(); f.advance(16000);
  assert.equal(f.engine.send(f.key, 'token').status, 'blocked');
  assert.equal(f.engine.heartbeat('wrong'), false); assert.equal(f.sent.length, 0);
});
test('OFF cannot be undone by heartbeat from an old daemon', () => {
  const f = fixture(); f.engine.stop(); assert.equal(f.engine.heartbeat('token'), false);
});
test('duplicate requests and repeated send calls submit only once', async () => {
  const f = fixture(); await f.ready(); f.engine.request(f.chats[1]);
  f.engine.send(f.key, 'token'); f.engine.send(f.key, 'token'); await settle();
  assert.equal(f.predictions.length, 1); assert.equal(f.sent.length, 1);
});
test('abstention sends nothing', async () => {
  const f = fixture(); f.engine.request(f.chats[1]); await settle(); f.resolve({ text: null }); await settle();
  assert.equal(f.engine.snapshot().jobs[0].status, 'abstained'); assert.equal(f.sent.length, 0);
});
test('can process a newly completed turn in the same background chat', async () => {
  const f = fixture(); await f.ready(); f.engine.send(f.key, 'token'); await settle();
  f.chats[1].turnId = 'c'; f.engine.request(f.chats[1]); await settle();
  f.resolve({ text: 'Next prediction', sourceTurnId: 'c' }); await settle();
  f.engine.send('local/background/c', 'token'); await settle(); assert.equal(f.sent.length, 2);
});
test('new active chats are included without selection changes', async () => {
  const f = fixture(); f.chats.push({ ...f.chats[1], id: 'new-chat' });
  f.engine.request(f.chats[2]); await settle(); f.resolve({ text: 'New task prediction' }); await settle();
  f.engine.send('local/new-chat/b', 'token'); await settle();
  assert.equal(f.sent[0].id, 'new-chat'); assert.equal(f.ui.selected, 'selected');
});
test('a persistent thread exclusion prevents requests and is visible in status', () => {
  const f = fixture(); f.engine.setExclusions(['background']);
  assert.equal(f.engine.request(f.chats[1]), 'blocked');
  assert.equal(f.engine.snapshot().chats[1].userExcluded, true);
  assert.equal(f.engine.snapshot().chats[0].userExcluded, false);
});
test('excluding a pending prediction cancels it while other chats can still send', async () => {
  const f = fixture(); f.engine.request(f.chats[1]); await settle();
  f.engine.heartbeat('token', {mode:'all',threads:[],exclude:['background']}); f.resolve({ text: 'Excluded prediction' }); await settle();
  assert.equal(f.engine.snapshot().jobs[0].status, 'cancelled');
  assert.equal(f.engine.send(f.key, 'token').status, 'blocked');
  f.chats.push({ ...f.chats[1], id: 'other-chat' }); f.engine.request(f.chats[2]); await settle();
  f.resolve({ text: 'Other prediction' }); await settle();
  f.engine.send('local/other-chat/b', 'token'); await settle();
  assert.deepEqual(f.sent, [{ id: 'other-chat', text: 'Other prediction' }]);
});
test('selected mode sends only to the selected thread', async () => {
  const f = fixture(); f.engine.configure({ mode: 'selected', threads: ['background'], exclude: [] });
  f.chats.push({ ...f.chats[1], id: 'not-selected' });
  assert.equal(f.engine.request(f.chats[2]), 'blocked');
  await f.ready(); f.engine.send(f.key, 'token'); await settle();
  assert.deepEqual(f.sent, [{ id: 'background', text: 'Exact prediction' }]);
});
test('changing selection cancels an outstanding result for the former target', async () => {
  const f = fixture(); f.engine.request(f.chats[1]); await settle();
  f.engine.configure({ mode: 'selected', threads: ['selected'], exclude: [] });
  f.resolve({ text: 'Stale selection' }); await settle();
  assert.equal(f.engine.snapshot().jobs[0].status, 'cancelled'); assert.equal(f.sent.length, 0);
});
test('changing selection after a prediction is ready prevents submission', async () => {
  const f = fixture(); await f.ready(); f.engine.configure({ mode: 'selected', threads: ['selected'], exclude: [] });
  assert.equal(f.engine.send(f.key, 'token').reason, 'not-targeted'); assert.equal(f.sent.length, 0);
});
test('renderer snapshots never export prediction text', async () => {
  const f = fixture(); await f.ready(); assert.ok(!JSON.stringify(f.engine.snapshot()).includes('Exact prediction'));
});
test('empty default selection cannot send', () => {
  const engine = createEngine({ list: () => [], ui: () => ({}), get: () => ({ hostId:'local', id:'one', active:true, status:'completed', turnId:'a' }) }, 'token');
  assert.equal(engine.request({ hostId:'local', id:'one', turnId:'a' }), 'blocked');
});
