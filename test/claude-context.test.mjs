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
