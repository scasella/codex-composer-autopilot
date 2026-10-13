import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createController, parseSuggestion, parseSuggestions, predictionRequest } from '../integrations/core.mjs';
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
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a'); await f.run(); await f.run(f.b,{id:other});
  assert.equal(f.sent.length,2); await f.b.command('off',other,'/b'); await f.run(); assert.equal(f.sent.length,2);
});
test('selected targets and persistent exclusions apply across instances', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command(`on ${id}`,id,'/a'); await f.run(f.b,{id:other}); assert.equal(f.sent.length,0);
  await f.a.command('on all',id,'/a'); await f.b.command('off here',other,'/b');
  await f.run(f.b,{id:other}); await f.run(); assert.equal(f.sent.length,1);
});
test('off during prediction prevents submission', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a');
  await f.run(f.a,{predict:async()=>{await f.b.command('off',other,'/b');return '{"suggestion":"Continue."}';}});
  assert.equal(f.sent.length,0);
});
test('changed draft, session, queue, or source while predicting prevents submission', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a'); let current=true;
  await f.run(f.a,{current:()=>current,predict:async()=>{current=false;return '{"suggestion":"Continue."}';}});
  assert.equal(f.sent.length,0);
});
test('reload or ambiguous send never resubmits the same source', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a');
  await assert.rejects(f.run(f.a,{source:'turn-a',submit:()=>{throw Error('lost receipt');}}));
  await f.run(f.b,{source:'turn-a'}); assert.equal(f.predicted.length,1); assert.equal(f.sent.length,0);
});
test('limit stops a loop and a human message resets the counter', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a'); await f.a.command('limit 2',id,'/a');
  await f.run(); await f.run(); await f.run(); assert.equal(f.sent.length,2);
  assert.match(await f.a.command('status',id,'/a'),/^PAUSED/);
  await f.a.human(id); assert.match(await f.a.command('status',id,'/a'),/^ON/);
  await f.run(); assert.equal(f.sent.length,3);
});
test('malformed output halts the session until explicit enable', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a');
  await assert.rejects(f.run(f.a,{predict:async()=>'{"suggestion":42}'})); await f.run(); assert.equal(f.sent.length,0);
  assert.match(await f.a.command('status',id,'/a'),/^PAUSED/);
  await f.a.command('on all',id,'/a'); await f.run(); assert.equal(f.sent.length,1);
});
test('null suggestion abstains; lack of model response is a failure', async () => {
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a');
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
  const f=fixture(); await f.a.command('mode auto',id,'/a'); await f.a.command('on all',id,'/a'); await Promise.all([f.run(),f.run()]); assert.equal(f.sent.length,1);
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
test('legacy configs without a delivery choice default to suggestions; invalid mode fails closed',async()=>{
  const f=fixture();await f.a.command('on',id,'/a');const c=await f.store.get('config');delete c.delivery;c.version=1;await f.store.set('config',c);
  let suggested=0;await f.run(f.a,{suggest:async()=>{suggested++;}});assert.equal(suggested,1);assert.equal(f.sent.length,0);
  await f.store.set('config',{...c,delivery:'unknown'});await assert.rejects(f.run(),/delivery/);assert.equal(f.sent.length,0);
});

test('changing delivery upgrades config so older auto-only plugins refuse it',async()=>{
  const f=fixture();await f.a.command('mode suggest',id,'/a');
  const c=await f.store.get('config');assert.equal(c.version,5);delete c.delivery;await f.store.set('config',c);
  await assert.rejects(f.run(),/delivery/);
});

test('default suggestions survive enabling and reload; explicit auto choice persists',async()=>{
  const f=fixture();let suggested=0;
  assert.match(await f.a.command('status',id,'/a'),/^OFF.*\nDelivery: suggest/);
  await f.a.command('on all',id,'/a');await f.run(f.b,{suggest:async()=>{suggested++;}});
  assert.equal(suggested,1);assert.deepEqual(f.sent,[]);
  await f.a.command('mode auto',id,'/a');await f.run(f.b);assert.equal(f.sent.length,1);
  assert.match(await f.b.command('status',id,'/a'),/Delivery: auto/);
});

test('Composer model is persisted without enabling or changing scope or delivery',async()=>{
  const f=fixture();await f.a.command('model haiku',id,'/a');
  let c=await f.store.get('config');assert.equal(c.enabled,false);assert.equal(c.delivery,'suggest');assert.deepEqual(c.sessions,[]);
  await f.a.command('on all',id,'/a');let selected;
  await f.run(f.b,{predict:async model=>{selected=model;return '{"suggestion":null}';}});assert.equal(selected,'haiku');
  assert.match(await f.b.command('model',other,'/b'),/Composer model: haiku/);
  await f.b.command('model session',other,'/b');c=await f.store.get('config');assert.equal(c.mode,'all');assert.equal(c.predictionModel,'session');
});
test('changing model during generation cancels the old result',async()=>{
  const f=fixture();await f.a.command('on all',id,'/a');let suggested=false;
  await f.run(f.a,{predict:async()=>{await f.b.command('model sonnet',other,'/b');return '{"suggestion":"Continue."}';},suggest:async()=>{suggested=true;}});
  assert.equal(suggested,false);assert.deepEqual(f.sent,[]);
});
test('old configs use the session model; missing or malformed new model settings fail closed',async()=>{
  const f=fixture();await f.a.command('on all',id,'/a');const c=await f.store.get('config');c.version=2;delete c.predictionModel;await f.store.set('config',c);
  await f.run(f.a,{predict:async model=>{assert.equal(model,'session');return '{"suggestion":null}';}});
  await f.store.set('config',{...c,version:3});await assert.rejects(f.run(),/model ID/);
  await f.store.set('config',{...c,version:3,predictionModel:'bad model'});await assert.rejects(f.run(),/model ID/);
});

test('effort persists independently without changing model, scope, mode, or enabled state',async()=>{
  const f=fixture();await f.a.command('model haiku',id,'/a');const before=await f.store.get('config');
  await f.a.command('effort low',id,'/a');const after=await f.store.get('config');
  assert.deepEqual({...after,revision:before.revision,predictionEffort:before.predictionEffort},before);
  assert.match(await f.b.command('effort',other,'/b'),/Composer effort: low/);
  await f.a.command('on all',id,'/a');let received;
  await f.run(f.b,{predict:async(model,effort)=>{received={model,effort};return '{"suggestion":null}';}});
  assert.deepEqual(received,{model:'haiku',effort:'low'});
  await f.a.command('effort default',id,'/a');assert.equal((await f.store.get('config')).predictionEffort,'default');
});
test('effort changes cancel a pending result and retained Tab acceptance',async()=>{
  const f=fixture();await f.a.command('on all',id,'/a');let suggested=false,valid;
  await f.run(f.a,{predict:async()=>{await f.b.command('effort high',other,'/b');return '{"suggestion":"Continue."}';},suggest:async()=>{suggested=true;}});
  assert.equal(suggested,false);assert.deepEqual(f.sent,[]);
  await f.run(f.a,{suggest:async(_text,guard)=>{valid=guard;}});assert.equal(await valid(),true);
  await f.b.command('effort low',other,'/b');assert.equal(await valid(),false);
});
test('legacy effort stays default and invalid effort never updates a saved choice',async()=>{
  const f=fixture();await f.a.command('on all',id,'/a');const c=await f.store.get('config');c.version=3;delete c.predictionEffort;await f.store.set('config',c);
  await f.run(f.a,{predict:async(_model,effort)=>{assert.equal(effort,'default');return '{"suggestion":null}';}});
  for(const choice of ['ultra','minimal','0','off'])await assert.rejects(f.a.command('effort '+choice,id,'/a'),/composer effort/);
  assert.deepEqual(await f.store.get('config'),c);
  await f.store.set('config',{...c,version:4});await assert.rejects(f.run(),/composer effort/);
  await f.store.set('config',{...c,version:4,predictionEffort:'unsupported'});await assert.rejects(f.run(),/composer effort/);
});


test('suggestion count persists without enabling or changing other settings; legacy configs default to one',async()=>{
  const f=fixture();await f.a.command('model haiku',id,'/a');const before=await f.store.get('config');
  await f.a.command('suggestions 3',id,'/a');const after=await f.store.get('config');
  assert.deepEqual({...after,revision:before.revision,suggestionCount:before.suggestionCount},before);
  assert.match(await f.b.command('suggestions',other,'/b'),/Suggestions: 3/);
  for(const n of ['0','11','1.5','-1','NaN','Infinity'])await assert.rejects(f.a.command('suggestions '+n,id,'/a'));
  assert.deepEqual(await f.store.get('config'),after);
  const legacy={...after,version:4};delete legacy.suggestionCount;await f.store.set('config',legacy);
  assert.match(await f.a.command('status',id,'/a'),/Suggestions: 1/);
  await f.store.set('config',{...legacy,version:5});await assert.rejects(f.run(),/suggestions N/);
});
test('multi suggestions use one request, deduplicate, abstain, and keep auto mode at one',async()=>{
  const f=fixture();await f.a.command('suggestions 3',id,'/a');await f.a.command('on all',id,'/a');let offered,guard,calls=0;
  await f.run(f.b,{predict:async(_model,_effort,count)=>{calls++;assert.equal(count,3);return JSON.stringify({suggestions:['Run tests.','Review diff.',' run tests. ']});},suggest:async(text,valid,candidates)=>{offered=candidates;guard=valid;assert.equal(text,'Run tests.');}});
  assert.equal(calls,1);assert.deepEqual(offered,['Run tests.','Review diff.']);assert.equal(await guard(),true);assert.deepEqual(f.sent,[]);
  await f.a.command('suggestions 2',id,'/a');assert.equal(await guard(),false);
  await f.run(f.b,{predict:async()=>'{"suggestions":[]}',suggest:async()=>assert.fail('abstention cannot show')});
  assert.equal(f.values.get('session-'+id).status,'abstained');
  await f.a.command('mode auto',id,'/a');await f.run(f.b,{predict:async(_model,_effort,count)=>{assert.equal(count,1);return '{"suggestion":"Run tests."}';}});assert.deepEqual(f.sent,['Run tests.']);
});
test('multi-candidate output validates the entire batch before any delivery',()=>{
  for(const value of [{suggestion:'x'},{suggestions:[null]},{suggestions:['a','b','c','d']},{suggestions:['good',42]},{suggestions:['a\nb']},{suggestions:['x'.repeat(241)]},{suggestions:['']},{suggestions:['a'],extra:true}])assert.throws(()=>parseSuggestions(JSON.stringify(value),3));
  assert.deepEqual(parseSuggestions('{"suggestions":[]}',3),[]);
  assert.deepEqual(parseSuggestions('{"suggestion":null}'),[]);
  assert.ok(predictionRequest('EXACT',3).startsWith('EXACT\n\n'));
  assert.match(predictionRequest('EXACT',3),/"maxItems":3/);
});
test('changing suggestion count during generation discards the whole batch',async()=>{
  const f=fixture();await f.a.command('on all',id,'/a');await f.a.command('suggestions 3',id,'/a');
  await f.run(f.a,{predict:async()=>{await f.b.command('suggestions 2',other,'/b');return '{"suggestions":["Run tests.","Review diff."]}';},suggest:async()=>assert.fail('stale batch')});
  assert.equal(f.values.get('session-'+id).status,'cancelled');assert.deepEqual(f.sent,[]);
});
