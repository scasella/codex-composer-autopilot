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
  const hooks=new Map(),sent=[],notes=[],requests=[];let keyHandler,widget,command,source='turn-a',draft='',response='{"suggestion":"Run the tests."}',during,usage;
  composer({on:(name,fn)=>hooks.set(name,fn),registerCommand:(_name,opts)=>{command=opts.handler;},sendUserMessage:(text,options)=>sent.push({text,options})});
  if(old===undefined)delete process.env.COMPOSER_PI_HOME;else process.env.COMPOSER_PI_HOME=old;
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ctx={cwd:'/project',hasUI:true,sessionManager:{getSessionId:()=>id,getLeafId:()=>source},
    ui:{notify:x=>notes.push(x),getEditorText:()=>draft,setEditorText:x=>{draft=x;},setWidget:(_key,x)=>{widget=x;},onTerminalInput:fn=>{keyHandler=fn;return()=>{keyHandler=undefined;};}},model:{id:'fixture'},hasPendingMessages:()=>false,getSystemPrompt:()=> 'system',
    modelRegistry:{getAvailable:()=>[{provider:'fixture-provider',id:'fast/model'}],find:(provider,name)=>provider==='fixture-provider'&&name==='fast/model'?{provider,id:name}:undefined,hasConfiguredAuth:()=>true,streamSimple:(model,context,options)=>({result:async()=>{
      requests.push({model,context,options});
      assert.ok(context.messages.at(-1).content[0].text.startsWith(exact));
      await during?.();return {usage,stopReason:'stop',content:[{type:'text',text:response}]};
    }})}};
  const event={outcome:'completed',continue:false,context:{pendingMessages:[],llmMessages:[{role:'assistant',content:[{type:'text',text:'Done.'}]}]}};
  const run=()=>hooks.get('agent_before_settle')(event,ctx);
  await hooks.get('session_start')({},ctx);
  return {dir,hooks,ctx,event,sent,notes,requests,run,source:x=>{source=x;},key:data=>keyHandler?.(data),widget:()=>widget,draft:()=>draft,command:args=>command(args,ctx),usage:x=>{usage=x;},response:x=>{response=x;},setDraft:x=>{draft=x;},during:fn=>{during=fn;}};
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
  const hooks=new Map(),files=new Map(),sent=[],suggested=[],logs=[],requests=[];let timer,draft='',during,response;
  const on=(event,matcher,fn)=>hooks.set(event,fn??matcher);register(on);
  const $={env:{get:async name=>name==='HOME'?'/home/test':undefined},plugin:{root:'/plugin'},
    fs:{exists:async p=>files.has(p),read:async p=>p.endsWith('composer-v5.txt')?exact:files.get(p),write:async(p,s)=>{files.set(p,s);},list:async()=>[]},
    session:{id:async()=>id,cwd:async()=>'/project',model:async()=>'coding-model',messages:async()=>[{role:'user',text:'Fix the widget.',toolUses:[]},{role:'assistant',text:'Fixed.',toolUses:[]}]},command:{register:async()=>{}},ui:{log:async text=>logs.push(text),invalidate:()=>{},resolve:()=>Object.fromEntries(['Box','Text','Select'].map(type=>[type,props=>({type,props})]))},
    clock:{after:(_ms,fn)=>{timer=fn;return{cancel:()=>{timer=undefined;}};}},
    model:{complete:async request=>{requests.push(request);await during?.();return{isAnswered:true,text:response??'{\"suggestion\":\"Check the widget.\"}'};},fork:async({prompt})=>{requests.push({fork:true,prompt});assert.ok(prompt.startsWith(exact));await during?.();return{text:response??'{"suggestion":"Run the tests."}'};}},
    prompt:{read:async()=>({text:draft}),suggest:async({text})=>{suggested.push(text);return{isShown:true};},submit:async({text})=>{sent.push(text);return{text};}}};
  const next=async()=>({});const emit=(name,event={})=>hooks.get(name)($,event,next);
  return {$,sent,suggested,logs,requests,emit,response:x=>{response=x;},during:fn=>{during=fn;},setDraft:s=>{draft=s;},command:args=>emit('command.run',{args}),
    async flush(){const fn=timer;timer=undefined;if(fn)await fn();await settle();},
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

test('Pi lists configured models and uses selected provider without changing coding model',async t=>{
  const f=await piFixture(t),codingModel=f.ctx.model;await f.command('models');assert.match(f.notes.at(-1),/fixture-provider\/fast\/model/);
  await f.command('model fixture-provider/fast/model');await f.command('on');await f.run();
  assert.deepEqual(f.requests[0].model,{provider:'fixture-provider',id:'fast/model'});assert.equal(f.ctx.model,codingModel);assert.deepEqual(f.sent,[]);
  assert.equal(f.requests[0].context.messages[0].role,'assistant');
  await f.command('model session');f.source('turn-b');await f.run();assert.equal(f.requests[1].model,codingModel);
});
test('Pi rejects unknown or unauthenticated choices without replacing settings',async t=>{
  const f=await piFixture(t);await f.command('model no-such-provider/model');assert.match(f.notes.at(-1),/Unknown Composer model/);
  f.ctx.modelRegistry.hasConfiguredAuth=()=>false;await f.command('model fixture-provider/fast/model');assert.match(f.notes.at(-1),/No configured credentials/);
  await f.command('on');await f.run();assert.equal(f.requests[0].model,f.ctx.model);
});
test('Claude custom Composer model receives visible transcript and exact prompt without forking',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('model haiku');await f.command('on');await f.run();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'haiku');assert.ok(f.requests[0].prompt.map(b=>b.text).join('').includes('Fix the widget.'));
  assert.ok(f.requests[0].prompt.map(b=>b.text).join('').includes(exact));assert.deepEqual(f.suggested,['Check the widget.']);assert.deepEqual(f.sent,[]);
  await f.command('model session');await f.run({turnId:'turn-b'});assert.equal(f.requests[1].fork,true);
});
test('Claude model failure never falls back to the coding model or sends',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('model missing-model');await f.command('on');
  f.$.model.complete=async()=>({isAnswered:false,reason:'unavailable'});await f.run();
  assert.deepEqual(f.suggested,[]);assert.deepEqual(f.sent,[]);assert.equal(f.requests.length,0);assert.match(f.logs.at(-1),/No fallback/);
});
test('Claude switching models during completion cancels the old suggestion',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('model haiku');await f.command('on');
  f.during(()=>f.command('model sonnet'));await f.run();assert.deepEqual(f.suggested,[]);assert.deepEqual(f.sent,[]);
});

test('Pi sends every explicit effort only on Composer requests and restores its default',async t=>{
  const f=await piFixture(t),codingModel=f.ctx.model;await f.command('on');
  for(const effort of ['low','medium','high','xhigh','max','default']){
    await f.command('effort '+effort);f.source('turn-'+effort);await f.run();
    assert.equal(f.requests.at(-1).options.reasoning,effort==='default'?'high':effort);assert.equal(f.ctx.model,codingModel);
  }
  assert.deepEqual(f.sent,[]);
});
test('Claude explicit effort with session model uses independent completion; default restores fork',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('on');
  for(const effort of ['low','medium','high','xhigh','max']){
    await f.command('effort '+effort);await f.run({turnId:'turn-'+effort});
    assert.equal(f.requests.at(-1).model,'coding-model');assert.equal(f.requests.at(-1).effort,effort);assert.equal(await f.$.session.model(),'coding-model');
  }
  await f.command('effort default');await f.run({turnId:'turn-default'});assert.equal(f.requests.at(-1).fork,true);assert.deepEqual(f.sent,[]);
});
test('Claude selected model effort can be reset without changing the model',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('model haiku');await f.command('effort low');await f.command('on');await f.run();
  assert.equal(f.requests[0].model,'haiku');assert.equal(f.requests[0].effort,'low');
  await f.command('effort default');await f.run({turnId:'turn-b'});assert.equal(f.requests[1].model,'haiku');assert.equal(Object.hasOwn(f.requests[1],'effort'),false);
});
test('Claude effort change during completion prevents delivery of the old result',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('effort high');await f.command('mode auto');await f.command('on');
  f.during(()=>f.command('effort low'));await f.run();assert.deepEqual(f.sent,[]);assert.deepEqual(f.suggested,[]);
});


test('Pi cycles candidate previews in both directions, wraps, and Tab accepts only the selected draft',async t=>{
  const f=await piFixture(t);await f.command('suggestions 3');await f.command('on');f.response('{"suggestions":["Run tests.","Review diff.","Commit changes."]}');await f.run();
  assert.equal(f.requests.length,1);assert.match(f.requests[0].context.messages.at(-1).content[0].text,/"maxItems":3/);assert.match(f.widget()[0],/1\/3/);
  assert.deepEqual(f.key('\x1b[A'),{consume:true});await waitFor(()=>f.widget()[0].includes('3/3'));
  assert.deepEqual(f.key('\x1b[B'),{consume:true});await waitFor(()=>f.widget()[0].includes('1/3'));
  assert.deepEqual(f.key('\x1b[57353u'),{consume:true});await waitFor(()=>f.widget()[0].includes('2/3'));
  f.key('\t');await waitFor(()=>f.draft()!=='');assert.equal(f.draft(),'Review diff.');assert.deepEqual(f.sent,[]);
});
test('Pi cycling refuses stale settings and ordinary arrows pass through without multiple candidates',async t=>{
  const f=await piFixture(t);assert.equal(f.key('\x1b[B'),undefined);await f.command('suggestions 2');await f.command('on');f.response('{"suggestions":["Run tests.","Review diff."]}');await f.run();
  const p=path.join(f.dir,'config.json'),c=JSON.parse(await fs.readFile(p,'utf8'));c.enabled=false;c.revision='external-off';await fs.writeFile(p,JSON.stringify(c));
  f.key('\x1b[B');await waitFor(()=>f.widget()===undefined);assert.equal(f.draft(),'');assert.deepEqual(f.sent,[]);
});
test('Claude native candidate picker preserves the host UI and previews a selection without sending',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('suggestions 3');await f.command('on');f.response('{"suggestions":["Run tests.","Review diff.","Commit changes."]}');await f.run();
  assert.equal(f.requests.length,1);assert.match(typeof f.requests[0].prompt==='string'?f.requests[0].prompt:f.requests[0].prompt.map(b=>b.text).join(''),/"maxItems":3/);
  const tree=await f.emit('ui.render',{component:'AbovePrompt',surface:'terminal'}),picker=tree.props.children[2];
  assert.deepEqual(tree.props.children[0],{});assert.equal(picker.type,'Select');assert.equal(picker.props.options.length,3);
  await picker.props.onSelect('1');assert.deepEqual(f.suggested,['Run tests.','Review diff.']);assert.deepEqual(f.sent,[]);
  await f.emit('prompt.edit',{text:'my draft'});await picker.props.onSelect('2');assert.equal(f.suggested.length,2);assert.deepEqual(await f.emit('ui.render',{component:'AbovePrompt',surface:'terminal'}),{});
});
test('Claude picker rechecks settings changed by another session before selecting',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('suggestions 2');await f.command('on');f.response('{"suggestions":["Run tests.","Review diff."]}');await f.run();
  const tree=await f.emit('ui.render',{component:'AbovePrompt',surface:'terminal'}),picker=tree.props.children[2];
  const p='/home/test/.claude/composer-autopilot/config.json',c=JSON.parse(await f.$.fs.read(p));c.enabled=false;c.revision='external-off';await f.$.fs.write(p,JSON.stringify(c));
  await picker.props.onSelect('1');assert.deepEqual(f.suggested,['Run tests.']);assert.deepEqual(f.sent,[]);
});


test('Claude explicit model and effort send the multi-candidate schema through complete',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('suggestions 2');await f.command('model haiku');await f.command('effort low');await f.command('on');f.response('{"suggestions":["Run tests.","Review diff."]}');await f.run();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'haiku');assert.equal(f.requests[0].effort,'low');assert.match(typeof f.requests[0].prompt==='string'?f.requests[0].prompt:f.requests[0].prompt.map(b=>b.text).join(''),/"maxItems":2/);assert.deepEqual(f.suggested,['Run tests.']);
  for(const props of [{hasSurvey:true},{isWorking:true},{view:{agentId:'subagent'}}])assert.deepEqual(await f.emit('ui.render',{component:'AbovePrompt',surface:'terminal',props}),{});
  assert.deepEqual(f.sent,[]);
});


test('Claude persists actionable API diagnostics for completion and fork without delivering',async()=>{
  for(const choice of ['session','mythos']){
    const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('model '+choice);await f.command('on');
    const failure=async()=>({isAnswered:false,reason:'api-error',status:400,error:'invalid_request'});
    f.$.model.complete=failure;f.$.model.fork=failure;await f.run();
    assert.match(f.logs.at(-1),/HTTP 400, invalid_request/);assert.deepEqual(f.suggested,[]);assert.deepEqual(f.sent,[]);
    await f.command('status');assert.match(f.logs.at(-1),/^PAUSED/);assert.match(f.logs.at(-1),/HTTP 400/);
  }
});


test('Pi wires history caching and persists native cache usage in status',async t=>{
  const f=await piFixture(t);await f.command('on');f.usage({cacheRead:2048,cacheWrite:512});await f.run();
  assert.equal(typeof f.requests[0].options.onPayload,'function');assert.equal(f.requests[0].options.sessionId,'composer-'+id);
  assert.equal(f.requests[0].options.cacheRetention,undefined);await f.command('status');assert.match(f.notes.at(-1),/Cache \(last prediction\): hit; read 2048, wrote 512 tokens/);
});
test('Claude complete and fork cache usage survives through status; missing usage is unknown',async()=>{
  for(const model of ['haiku','session']){
    const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('model '+model);await f.command('on');
    const response=async()=>({isAnswered:true,text:'{"suggestion":null}',usage:{cache_read_input_tokens:4096,cache_creation_input_tokens:256}});
    f.$.model.complete=response;f.$.model.fork=response;await f.run();await f.command('status');assert.match(f.logs.at(-1),/hit; read 4096, wrote 256 tokens/);
    f.$.model.complete=f.$.model.fork=async()=>({isAnswered:true,text:'{"suggestion":null}'});await f.run({turnId:'next'});await f.command('status');assert.match(f.logs.at(-1),/unavailable \(provider did not report cache usage\)/);
  }
});


test('Claude once works while OFF without a turn event, preserves model/effort/count and native picker',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});
  await f.command('model opus');await f.command('effort medium');await f.command('suggestions 3');
  const config=await f.$.fs.read('/home/test/.claude/composer-autopilot/config.json');
  f.response('{"suggestions":["Run tests.","Review diff.","Commit changes."]}');
  await f.command('once');assert.equal(f.requests.length,0);await f.flush();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'opus');assert.equal(f.requests[0].effort,'medium');
  assert.match(f.requests[0].prompt.map(b=>b.text).join(''),/"maxItems":3/);
  assert.deepEqual(f.suggested,['Run tests.']);assert.deepEqual(f.sent,[]);
  const tree=await f.emit('ui.render',{component:'AbovePrompt',surface:'terminal'});
  await tree.props.children[2].props.onSelect('1');assert.equal(f.suggested.at(-1),'Review diff.');
  assert.equal(await f.$.fs.read('/home/test/.claude/composer-autopilot/config.json'),config);
  await f.command('status');assert.match(f.logs.at(-1),/^OFF/);assert.match(f.logs.at(-1),/Last: one-shot suggested/);
  await f.run();assert.equal(f.requests.length,1);
});
test('Claude once always suggests in auto mode and may be explicitly repeated on the same turn',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});await f.command('mode auto');await f.command('on');
  await f.run();assert.equal(f.sent.length,1);
  for(let i=0;i<2;i++){await f.command('once');await f.flush();}
  assert.equal(f.requests.length,3);assert.equal(f.suggested.length,2);assert.equal(f.sent.length,1);
  await f.run();assert.equal(f.requests.length,3); // Automatic source reservation survives manual requests.
});
test('Claude once reports abstention, display refusal and API failure, and permits an explicit retry',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});
  f.response('{"suggestion":null}');await f.command('once');await f.flush();assert.match(f.logs.at(-1),/no grounded/);
  f.$.model.fork=async()=>({isAnswered:false,reason:'api-error',status:429});
  await f.command('once');await f.flush();assert.match(f.logs.at(-1),/once failed.*429/);
  f.$.model.fork=async()=>({text:'{"suggestion":"Try again."}'});
  f.$.prompt.suggest=async()=>({isShown:false});
  await f.command('once');await f.flush();assert.match(f.logs.at(-1),/could not display/);
  f.$.prompt.suggest=async()=>({isShown:true});await f.command('once');await f.flush();assert.match(f.logs.at(-1),/suggestions ready/);
  assert.deepEqual(f.sent,[]);
});
test('Claude once refuses busy/headless sessions and cancels on input, settings, new turns or session end',async()=>{
  const headless=claudeFixture();await headless.emit('session.start');await headless.command('once');await headless.flush();assert.equal(headless.requests.length,0);
  const busy=claudeFixture();await busy.emit('session.start',{isInteractive:true});await busy.emit('turn.start',{turnId:'coding'});await busy.command('once');await busy.flush();assert.equal(busy.requests.length,0);assert.match(busy.logs.at(-1),/idle interactive/);
  for(const change of [f=>f.emit('prompt.edit',{text:'mine'}),f=>f.command('off'),f=>f.command('model opus'),f=>f.emit('turn.start',{turnId:'new'}),f=>f.emit('session.end')]){
    const f=claudeFixture();await f.emit('session.start',{isInteractive:true});f.during(()=>change(f));await f.command('once');await f.flush();assert.deepEqual(f.suggested,[]);assert.deepEqual(f.sent,[]);
  }
});
test('Claude once reports an in-flight prediction instead of starting another',async()=>{
  const f=claudeFixture();await f.emit('session.start',{isInteractive:true});
  let release;f.during(()=>new Promise(resolve=>{release=resolve;}));
  await f.command('once');const first=f.flush();await waitFor(()=>!!release);
  await f.command('once');await f.flush();assert.match(f.logs.at(-1),/still running/);assert.equal(f.requests.length,1);
  release();await first;assert.deepEqual(f.suggested,[]);assert.deepEqual(f.sent,[]);
});
