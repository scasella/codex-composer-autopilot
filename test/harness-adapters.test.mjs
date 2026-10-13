import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import composer from '../integrations/pi.mjs';
import { register } from '../hooks/register.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const exact=await fs.readFile(new URL('../prompts/composer-v5.txt',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
async function piFixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'composer-pi-'));
  const old=process.env.COMPOSER_PI_HOME;process.env.COMPOSER_PI_HOME=dir;
  const hooks=new Map(),sent=[],notes=[];let keyHandler,widget,command,source='turn-a',draft='',response='{"suggestion":"Run the tests."}',during;
  composer({on:(name,fn)=>hooks.set(name,fn),registerCommand:(_name,opts)=>{command=opts.handler;},sendUserMessage:(text,options)=>sent.push({text,options})});
  if(old===undefined)delete process.env.COMPOSER_PI_HOME;else process.env.COMPOSER_PI_HOME=old;
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ctx={cwd:'/project',hasUI:true,sessionManager:{getSessionId:()=>id,getLeafId:()=>source},
    ui:{notify:x=>notes.push(x),getEditorText:()=>draft,setEditorText:x=>{draft=x;},setWidget:(_key,x)=>{widget=x;},onTerminalInput:fn=>{keyHandler=fn;return()=>{keyHandler=undefined;};}},model:{id:'fixture'},hasPendingMessages:()=>false,getSystemPrompt:()=> 'system',
    modelRegistry:{streamSimple:(_model,context,options)=>({result:async()=>{
      assert.ok(context.messages.at(-1).content[0].text.startsWith(exact));assert.equal(options.reasoning,'high');
      await during?.();return {stopReason:'stop',content:[{type:'text',text:response}]};
    }})}};
  const event={outcome:'completed',continue:false,context:{pendingMessages:[],llmMessages:[{role:'assistant',content:[{type:'text',text:'Done.'}]}]}};
  const run=()=>hooks.get('agent_before_settle')(event,ctx);
  await hooks.get('session_start')({},ctx);
  return {dir,hooks,ctx,event,sent,notes,run,key:data=>keyHandler?.(data),widget:()=>widget,draft:()=>draft,command:args=>command(args,ctx),setDraft:x=>{draft=x;},during:fn=>{during=fn;}};
}
test('Pi native boundary submits exact text without invoking commands or changing draft',async t=>{
  const f=await piFixture(t);await f.command('mode auto');await f.command('on');await f.run();
  assert.deepEqual(f.sent,[{text:'Run the tests.',options:{deliverAs:'followUp',expandPromptTemplates:false}}]);
});
test('Pi never sends after OFF or user input during prediction',async t=>{
  const f=await piFixture(t);await f.command('mode auto');await f.command('on');f.during(()=>f.command('off'));await f.run();assert.equal(f.sent.length,0);
});
test('Pi skips drafts, aborted turns, and queued continuation',async t=>{
  const f=await piFixture(t);await f.command('mode auto');await f.command('on');f.setDraft('mine');await f.run();f.setDraft('');
  f.event.outcome='aborted';await f.run();f.event.outcome='completed';f.event.context.pendingMessages=[{}];await f.run();assert.equal(f.sent.length,0);
});
function claudeFixture() {
  const hooks=new Map(),files=new Map(),sent=[],suggested=[],logs=[];let timer,draft='',during;
  const on=(event,matcher,fn)=>hooks.set(event,fn??matcher);register(on);
  const $={env:{get:async name=>name==='HOME'?'/home/test':undefined},plugin:{root:'/plugin'},
    fs:{exists:async p=>files.has(p),read:async p=>p.endsWith('composer-v5.txt')?exact:files.get(p),write:async(p,s)=>{files.set(p,s);},list:async()=>[]},
    session:{id:async()=>id,cwd:async()=>'/project'},command:{register:async()=>{}},ui:{log:async text=>logs.push(text)},
    clock:{after:(_ms,fn)=>{timer=fn;return{cancel:()=>{timer=undefined;}};}},
    model:{fork:async({prompt})=>{assert.ok(prompt.startsWith(exact));await during?.();return{text:'{"suggestion":"Run the tests."}'};}},
    prompt:{read:async()=>({text:draft}),suggest:async({text})=>{suggested.push(text);return{isShown:true};},submit:async({text})=>{sent.push(text);return{text};}}};
  const next=async()=>({});const emit=(name,event={})=>hooks.get(name)($,event,next);
  return {$,sent,suggested,logs,emit,during:fn=>{during=fn;},setDraft:s=>{draft=s;},command:args=>emit('command.run',{args}),
    async run(event={}){await emit('turn.complete',{turnId:'turn-a',reason:'answer',isAborted:false,answer:'Done.',...event});const fn=timer;timer=undefined;if(fn)await fn();await settle();}};
}
test('Claude native adapter forks context and submits one user prompt',async()=>{
  const f=claudeFixture();await f.emit('session.start');await f.command('mode auto');await f.command('on');await f.run();assert.deepEqual(f.sent,['Run the tests.']);
});
test('Claude OFF while fork is running cancels submission',async()=>{
  const f=claudeFixture();await f.emit('session.start');await f.command('mode auto');await f.command('on');f.during(()=>f.command('off'));await f.run();assert.equal(f.sent.length,0);
});
test('Claude skips drafts, subagents, interrupted turns, and errors',async()=>{
  const f=claudeFixture();await f.emit('session.start');await f.command('mode auto');await f.command('on');f.setDraft('mine');await f.run();f.setDraft('');
  await f.run({isAborted:true});await f.run({agentId:'subagent'});await f.run({reason:'error'});assert.equal(f.sent.length,0);
});
test('Claude user typing during fork prevents submission',async()=>{
  const f=claudeFixture();await f.emit('session.start');await f.command('mode auto');await f.command('on');f.during(()=>f.emit('prompt.edit',{text:'mine'}));await f.run();assert.equal(f.sent.length,0);
});

async function waitFor(check) {
  for (let n=0;n<200;n++) { if(check())return; await new Promise(r=>setTimeout(r,5)); }
  assert.ok(check(),'asynchronous Tab acceptance did not finish');
}
test('Pi defaults to suggestion previews; Tab fills only the draft',async t=>{
  const f=await piFixture(t);await f.command('on');await f.run();
  assert.match(f.widget()[0],/Run the tests/);assert.equal(f.draft(),'');assert.deepEqual(f.sent,[]);
  assert.deepEqual(f.key('\t'),{consume:true});await waitFor(()=>f.draft()!=='');
  assert.equal(f.draft(),'Run the tests.');assert.equal(f.widget(),undefined);assert.deepEqual(f.sent,[]);
});
test('Pi Kitty Tab fills the draft; ordinary Tab without a preview passes through',async t=>{
  const f=await piFixture(t);assert.equal(f.key('\t'),undefined);
  await f.command('mode suggest');await f.command('on');await f.run();
  assert.equal(f.key('\x1b[O'),undefined);assert.equal(f.key('\x1b[I'),undefined);assert.ok(f.widget());
  assert.deepEqual(f.key('\x1b[9;1u'),{consume:true});f.key('\x1b[9;1:3u');await waitFor(()=>f.draft()!=='');assert.deepEqual(f.sent,[]);
});
test('Pi typing, Escape, Enter, and session switches dismiss without accepting',async t=>{
  for(const key of ['x','\x1b','\r']){
    const f=await piFixture(t);await f.command('mode suggest');await f.command('on');await f.run();
    assert.equal(f.key(key),undefined);assert.equal(f.widget(),undefined);assert.equal(f.draft(),'');assert.deepEqual(f.sent,[]);
  }
  const f=await piFixture(t);await f.command('mode suggest');await f.command('on');await f.run();
  await f.hooks.get('session_before_switch')({},f.ctx);assert.equal(f.widget(),undefined);assert.equal(f.key('\t'),undefined);
});
test('Pi OFF from another process prevents accepting a retained suggestion',async t=>{
  const f=await piFixture(t);await f.command('mode suggest');await f.command('on');await f.run();
  const file=path.join(f.dir,'config.json'),c=JSON.parse(await fs.readFile(file,'utf8'));
  await fs.writeFile(file,JSON.stringify({...c,enabled:false,revision:'external-off'}));
  f.key('\t');await new Promise(r=>setTimeout(r,30));assert.equal(f.draft(),'');assert.deepEqual(f.sent,[]);
});
test('Pi input while Tab acceptance is checking settings never overwrites a draft',async t=>{
  const f=await piFixture(t);await f.command('mode suggest');await f.command('on');await f.run();
  f.key('\t');f.key('x');f.setDraft('my draft');await new Promise(r=>setTimeout(r,30));
  assert.equal(f.draft(),'my draft');assert.deepEqual(f.sent,[]);
});
test('suggest mode skips headless Pi sessions',async t=>{
  const f=await piFixture(t);f.ctx.hasUI=false;await f.command('mode suggest');await f.command('on');
  f.during(()=>assert.fail('headless session called the model'));await f.run();assert.deepEqual(f.sent,[]);assert.equal(f.widget(),undefined);
});
test('Claude defaults to native ghost text and never submits',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('on');await f.run();
  assert.deepEqual(f.suggested,['Run the tests.']);assert.deepEqual(f.sent,[]);
});
test('Claude suggestion mode skips headless sessions and cancels on OFF or mode changes',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:false});await f.command('mode suggest');await f.command('on');await f.run();
  assert.deepEqual(f.suggested,[]);assert.deepEqual(f.sent,[]);
  for(const command of ['off','mode auto']){
    const g=claudeFixture();await g.emit('session.start',{isInteractive:true});await g.command('mode suggest');await g.command('on');
    g.during(()=>g.command(command));await g.run();assert.deepEqual(g.suggested,[]);assert.deepEqual(g.sent,[]);
  }
});
