import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptRequest, completionText } from '../integrations/claude-context.mjs';

test('custom Claude context keeps first intent and newest turns within a bounded prompt',()=>{
  const messages=Array.from({length:300},(_,i)=>({role:i%2?'assistant':'user',text:`message-${i} `+'x'.repeat(20000),toolUses:[]}));
  const prompt=transcriptRequest('EXACT',messages);
  assert.ok(prompt.includes('message-0'));assert.ok(prompt.includes('message-299'));assert.ok(prompt.length<140000);
  assert.ok(prompt.endsWith('"additionalProperties":false}.'));
  const context=JSON.parse(prompt.split('\n\n')[1]);assert.ok(context.omittedMessages>0);assert.ok(context.messages.length<=80);
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
