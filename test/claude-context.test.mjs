import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptRequest, completionText } from '../integrations/claude-context.mjs';

test('custom Claude context keeps first intent and newest turns within a bounded prompt',()=>{
  const messages=Array.from({length:300},(_,i)=>({role:i%2?'assistant':'user',text:`message-${i} `+'x'.repeat(20000),toolUses:[]}));
  const blocks=transcriptRequest('EXACT',messages),prompt=blocks.map(b=>b.text).join('');
  assert.ok(prompt.includes('message-0'));assert.ok(prompt.includes('message-299'));assert.ok(prompt.length<140000);
  assert.ok(prompt.endsWith('"additionalProperties":false}.'));
  assert.ok(blocks.length<=82);assert.match(blocks.at(-1).text,/Omitted earlier entries: [1-9]/);assert.ok(blocks.filter(b=>b.cache).length<=3);
});
test('custom Claude context rejects unavailable or unknown history',()=>{
  for(const data of [null,[],[{}],[{role:'tool',text:'oops'}]])assert.throws(()=>transcriptRequest('EXACT',data));
});
test('completion result recognizes supported shapes and rejects failed or unknown replies',()=>{
  assert.equal(completionText('old text'),'old text');assert.equal(completionText({isAnswered:true,text:'new text'}),'new text');
  for(const data of [null,{}, {isAnswered:false,text:'do not use'}, {text:'unknown shape'}])assert.throws(()=>completionText(data),/No fallback/);
});


test('Claude API failures retain status and classification without exposing response bodies',()=>{
  for(const [status,error,expected] of [[400,'invalid_request',/model ID and effort/],[401,'authentication_failed',/authentication/],[429,'rate_limit',/rate limit/],[529,'overloaded',/service status/],[null,'unknown',/no HTTP status/]]){
    assert.throws(()=>completionText({isAnswered:false,reason:'api-error',status,error,body:'SECRET',headers:{authorization:'SECRET'},text:'SECRET'}),e=>{
      assert.ok(e.message.includes(error));assert.match(e.message,expected);assert.ok(!e.message.includes('SECRET'));return true;
    });
  }
  assert.throws(()=>completionText({isAnswered:false,reason:'api-error',status:400,error:'SECRET body'}),/HTTP 400, unknown/);
});
test('fork failures preserve diagnostics and cannot pass error text as a prediction',()=>{
  assert.equal(completionText({text:'legacy fork'},{legacyFork:true}),'legacy fork');
  assert.throws(()=>completionText({isAnswered:false,reason:'api-error',status:403,error:'authentication_failed',text:'not a prediction'},{legacyFork:true}),/HTTP 403/);
  assert.throws(()=>completionText({isAnswered:false,reason:'aborted'}),/cancelled or timed out/);
});


test('Claude cached history remains a byte-identical prefix when new turns or prediction settings change',()=>{
  const messages=Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',text:'message '+i,toolUses:[]}));
  const first=transcriptRequest('EXACT',messages,1);
  const next=transcriptRequest('EXACT',[...messages,{role:'user',text:'continue',toolUses:[]},{role:'assistant',text:'done',toolUses:[]}],3);
  assert.equal(first.slice(0,-1).map(b=>b.text).join(''),next.slice(0,first.length-1).map(b=>b.text).join(''));
  assert.equal(first.at(-1).cache,undefined);assert.equal(next.at(-1).cache,undefined);
  assert.equal(first.filter(b=>b.cache).length,3);assert.ok(next.at(-1).text.includes('EXACT'));
  assert.equal(first.at(-2).cache,true);assert.equal(first.at(-3).cache,true);
});
