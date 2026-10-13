import test from 'node:test';
import assert from 'node:assert/strict';
import { cachePiHistory, cacheUsage, cacheStatus } from '../integrations/cache.mjs';
const model={api:'anthropic-messages'};
const payload=()=>({system:[{type:'text',text:'system',cache_control:{type:'ephemeral'}}],messages:[
  {role:'user',content:[{type:'text',text:'task'}]},
  {role:'assistant',content:[{type:'thinking',thinking:'private'},{type:'text',text:'done'}]},
  {role:'user',content:[{type:'text',text:'predict',cache_control:{type:'ephemeral',ttl:'1h'}}]}
]});
test('Pi relocates only the prediction cache marker, preserving history, TTL and the source object',()=>{
  const p=payload(),before=structuredClone(p),out=cachePiHistory(p,model);
  assert.deepEqual(p,before);assert.equal(out.messages.at(-1).content[0].cache_control,undefined);
  assert.deepEqual(out.messages[1].content[1].cache_control,{type:'ephemeral',ttl:'1h'});
  assert.equal(out.messages[1].content[0].cache_control,undefined);assert.deepEqual(out.system,p.system);
  const strip=x=>JSON.parse(JSON.stringify(x,(k,v)=>k==='cache_control'?undefined:v));assert.deepEqual(strip(out),strip(p));
});
test('Pi leaves disabled caching, other providers and unknown wire shapes untouched',()=>{
  assert.equal(cachePiHistory(payload(),{api:'openai-responses'}),undefined);
  const p=payload();delete p.messages.at(-1).content[0].cache_control;assert.equal(cachePiHistory(p,model),undefined);
  for(const value of [null,{}, {messages:[]},{messages:[{role:'user',content:'text'}]}])assert.equal(cachePiHistory(value,model),undefined);
});
test('Pi skips thinking-only tails and does not increase the cache breakpoint count',()=>{
  const p=payload();p.messages[1].content.pop();p.messages[0].content[0].cache_control={type:'ephemeral'};
  const out=cachePiHistory(p,model);assert.deepEqual(out.messages[0].content[0].cache_control,{type:'ephemeral'});
  assert.equal(JSON.stringify(out).match(/cache_control/g).length,2);
});
test('cache telemetry distinguishes absent, zero, writes and hits, tolerating invalid usage',()=>{
  assert.match(cacheStatus(undefined),/not recorded/);assert.match(cacheStatus(null),/unavailable/);
  assert.match(cacheStatus({read:0,write:4096}),/no hit reported; read 0, wrote 4096/);
  assert.match(cacheStatus({read:123,write:0}),/hit; read 123, wrote 0/);
  assert.match(cacheStatus({write:123}),/hit unknown; read unknown/);
  for(const bad of [-1,NaN,Infinity,'3',1.5,Number.MAX_SAFE_INTEGER+1])assert.deepEqual(cacheUsage({read:bad,write:bad}),{read:null,write:null});
});
