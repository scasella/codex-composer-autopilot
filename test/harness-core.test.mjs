import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createController, parseSuggestion, predictionRequest } from '../integrations/core.mjs';
const id = 'session-aaaaaaaa', other = 'session-bbbbbbbb';
function fixture() {
  const values = new Map(), sent = [], predicted = [];
  const store = { async get(k) { return structuredClone(values.get(k)); }, async set(k,v) { values.set(k,structuredClone(v)); }, async keys() { return [...values.keys()]; } };
  const a = createController(store), b = createController(store);
  const run = (controller = a, patch = {}) => controller.run({ id, source: crypto.randomUUID(), cwd:'/project', current: () => true,
    predict: async () => { predicted.push(id); return '{"suggestion":"Run the tests."}'; }, submit: async text => { sent.push(text); }, ...patch });
  return { a,b,store,values,sent,predicted,run };
}
test('bundled prompt is the exact retrieved version 5 bytes', () => {
  const p = fs.readFileSync(new URL('../prompts/composer-v5.txt',import.meta.url));
  assert.equal(crypto.createHash('sha256').update(p).digest('hex'),'bf64e2c1b0e11dca1a982ab95e77afc4046422b3605849fb9d9da0fdca069418');
  assert.ok(predictionRequest(p.toString()).startsWith(p.toString()+'\n\n'));
});
test('installation starts OFF and does not call a model', async () => {
  const f=fixture(); await f.run(); assert.equal(f.predicted.length,0);
});
test('all targets multiple loaded sessions; off propagates across instances', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a'); await f.run(); await f.run(f.b,{id:other});
  assert.equal(f.sent.length,2); await f.b.command('off',other,'/b'); await f.run(); assert.equal(f.sent.length,2);
});
test('selected targets and persistent exclusions apply across instances', async () => {
  const f=fixture(); await f.a.command(`on ${id}`,id,'/a'); await f.run(f.b,{id:other}); assert.equal(f.sent.length,0);
  await f.a.command('on all',id,'/a'); await f.b.command('off here',other,'/b');
  await f.run(f.b,{id:other}); await f.run(); assert.equal(f.sent.length,1);
});
test('off during prediction prevents submission', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a');
  await f.run(f.a,{predict:async()=>{await f.b.command('off',other,'/b');return '{"suggestion":"Continue."}';}});
  assert.equal(f.sent.length,0);
});
test('changed draft, session, queue, or source while predicting prevents submission', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a'); let current=true;
  await f.run(f.a,{current:()=>current,predict:async()=>{current=false;return '{"suggestion":"Continue."}';}});
  assert.equal(f.sent.length,0);
});
test('reload or ambiguous send never resubmits the same source', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a');
  await assert.rejects(f.run(f.a,{source:'turn-a',submit:()=>{throw Error('lost receipt');}}));
  await f.run(f.b,{source:'turn-a'}); assert.equal(f.predicted.length,1); assert.equal(f.sent.length,0);
});
test('limit stops a loop and a human message resets the counter', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a'); await f.a.command('limit 2',id,'/a');
  await f.run(); await f.run(); await f.run(); assert.equal(f.sent.length,2);
  assert.match(await f.a.command('status',id,'/a'),/^PAUSED/);
  await f.a.human(id); assert.match(await f.a.command('status',id,'/a'),/^ON/);
  await f.run(); assert.equal(f.sent.length,3);
});
test('malformed output halts the session until explicit enable', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a');
  await assert.rejects(f.run(f.a,{predict:async()=>'{"suggestion":42}'})); await f.run(); assert.equal(f.sent.length,0);
  assert.match(await f.a.command('status',id,'/a'),/^PAUSED/);
  await f.a.command('on all',id,'/a'); await f.run(); assert.equal(f.sent.length,1);
});
test('null suggestion abstains; lack of model response is a failure', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a');
  await f.run(f.a,{predict:async()=>'{"suggestion":null}'}); assert.equal(f.sent.length,0);
  await assert.rejects(f.run(f.a,{predict:async()=>null}),/did not answer/);
});
test('strict output validation rejects extra fields, fences, multiline and overlong text', () => {
  for(const text of ['{}','[]','null','```json\n{}\n```','{"suggestion":""}','{"suggestion":"x","extra":1}',JSON.stringify({suggestion:'a\nb'}),JSON.stringify({suggestion:'x'.repeat(241)})]) assert.throws(()=>parseSuggestion(text));
  assert.equal(parseSuggestion('{"suggestion":" keep this spacing "}'),' keep this spacing ');
});
test('corrupt config and session state fail closed', async () => {
  const f=fixture(); await f.store.set('config',{enabled:true}); await assert.rejects(f.run()); assert.equal(f.sent.length,0);
  f.values.clear(); await f.a.command('on all',id,'/a'); await f.store.set('session-'+id,{id,count:'zero',status:'idle'}); await assert.rejects(f.run());
});
test('duplicate concurrent event calls make one prediction', async () => {
  const f=fixture(); await f.a.command('on all',id,'/a'); await Promise.all([f.run(),f.run()]); assert.equal(f.sent.length,1);
});

test('suggest mode preserves scope, stays off until enabled, and never consumes the auto limit',async()=>{
  const f=fixture(),suggestions=[];await f.a.command('mode suggest',id,'/a');await f.run();assert.equal(f.predicted.length,0);
  await f.a.command('on all',id,'/a');await f.a.command('limit 1',id,'/a');
  const suggest=async text=>{suggestions.push(text);return true;};
  await f.run(f.a,{suggest});await f.run(f.b,{id:other,suggest});await f.run(f.a,{suggest});
  assert.equal(suggestions.length,3);assert.deepEqual(f.sent,[]);assert.equal(f.values.get('session-'+id).count,0);
  assert.equal(f.values.get('session-'+id).status,'suggested');assert.match(await f.a.command('status',id,'/a'),/Delivery: suggest/);
});
test('retained suggestion guard checks configuration and source at acceptance time',async()=>{
  const f=fixture();let valid,current=true;await f.a.command('mode suggest',id,'/a');await f.a.command('on all',id,'/a');
  await f.run(f.a,{current:()=>current,suggest:async(_text,guard)=>{valid=guard;}});assert.equal(await valid(),true);
  current=false;assert.equal(await valid(),false);current=true;await f.b.command('mode auto',other,'/b');assert.equal(await valid(),false);
  assert.deepEqual(f.sent,[]);
});
test('legacy configs keep auto mode; invalid delivery mode fails closed',async()=>{
  const f=fixture();await f.a.command('on',id,'/a');const c=await f.store.get('config');delete c.delivery;c.version=1;await f.store.set('config',c);
  await f.run();assert.equal(f.sent.length,1);await f.store.set('config',{...c,delivery:'unknown'});
  await assert.rejects(f.run(),/delivery/);assert.equal(f.sent.length,1);
});

test('changing delivery upgrades config so older auto-only plugins refuse it',async()=>{
  const f=fixture();await f.a.command('mode suggest',id,'/a');
  const c=await f.store.get('config');assert.equal(c.version,2);delete c.delivery;await f.store.set('config',c);
  await assert.rejects(f.run(),/delivery/);
});
