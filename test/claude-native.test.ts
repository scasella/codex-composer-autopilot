import { test, expect, mock } from 'claude-code/testing';

test('native mod defaults to suggestions and sends only after explicit auto mode', async ($, on) => {
  const files = new Map<string,string>();
  const sent: string[] = [];
  const suggested: string[] = [];
  const logs: string[] = [];
  const clock = mock.clock(on);
  let expectedModel = 'haiku', expectedEffort, batch = false;
  const completions: unknown[] = [];
  mock.env(on, { HOME: '/test' });
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('turn.complete', async (_$, e) => ({ text: e.answer }));
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }));
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }));
  on('fs.read', async (_$, e) => ({ value: e.path.endsWith('composer-v5.txt') ? 'EXACT_TEST_PROMPT' : files.get(e.path) }));
  on('fs.write', async (_$, e) => { files.set(e.path,e.text); return { value: undefined }; });
  on('session.id', async () => ({ value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  on('session.model', async () => ({ value: 'coding-model' }));
  on('session.messages', async () => ({ value: [{role:'user',text:'Fix the fixture.',toolUses:[]},{role:'assistant',text:'Fixed.',toolUses:[]}] }));
  on('model.complete', async (_$, e) => {
    completions.push(e);expect(e.model).toBe(expectedModel);expect(e.effort).toBe(expectedEffort);expect(e.prompt).toMatch('Fix the fixture.');expect(e.prompt).toMatch('EXACT_TEST_PROMPT');
    expect(e.promptBlocks.filter(b=>b.cache).length).toBe(3);expect(e.promptBlocks.at(-1).cache).toBeUndefined();
    return { value: { isAnswered: true, usage: {cache_read_input_tokens: 2048, cache_creation_input_tokens: 128}, text: '{\"suggestion\":\"Check the fixture.\"}' } };
  });
  on('session.cwd', async () => ({ value: '/project' }));
  on('command.register', async () => ({ value: undefined }));
  on('ui.log', async (_$, e) => { logs.push(e.text); return { value: undefined }; });
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }));
  on('model.fork', async (_$, e) => {
    expect(e.prompt).toStartWith('EXACT_TEST_PROMPT\n\n');
    return { value: { text: batch ? '{"suggestions":["Run the tests.","Review the diff.","Commit the change."]}' : '{"suggestion":"Run the tests."}', usage: {} } };
  });
  on('prompt.suggest', async (_$, e) => { suggested.push(e.text); return { isShown: true }; });
  on('prompt.submit', async (_$, e) => { sent.push(e.text); return { text: e.text }; });
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true });
  await $.command.run({ command: 'composer', args: 'on all', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-a', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(logs.join('\n')).toMatch('ON for');
  expect(sent).toEqual([]);
  expect(suggested).toEqual(['Run the tests.']);
  await $.command.run({ command: 'composer', args: 'mode auto', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-suggest', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(suggested).toEqual(['Run the tests.']);
  expect(sent).toEqual(['Run the tests.']);
  await $.command.run({ command: 'composer', args: 'mode suggest', origin: { kind: 'composer' } });
  await $.command.run({ command: 'composer', args: 'model haiku', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-custom', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(suggested).toEqual(['Run the tests.','Check the fixture.']);
  expect(sent).toEqual(['Run the tests.']);
  await $.command.run({ command: 'composer', args: 'status', origin: { kind: 'composer' } });
  expect(logs.at(-1)).toMatch('hit; read 2048, wrote 128 tokens');
  expectedModel = 'coding-model';expectedEffort = 'low';
  await $.command.run({ command: 'composer', args: 'model session', origin: { kind: 'composer' } });
  await $.command.run({ command: 'composer', args: 'effort low', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-effort', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(completions.length).toBe(2);
  expect(suggested).toEqual(['Run the tests.','Check the fixture.','Check the fixture.']);
  await $.command.run({ command: 'composer', args: 'effort default', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-default-effort', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(completions.length).toBe(2);
  expect(suggested.at(-1)).toBe('Run the tests.');
  batch = true;
  await $.command.run({ command: 'composer', args: 'suggestions 3', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-candidates', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  for (const surface of ['terminal','desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'composer-autopilot', surface, component: 'AbovePrompt', props: {
      hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100,
      scroll: { offset: 0, bodyRows: 10 }, view: {}
    } });
    expect(await ui.find({ key: 'composer-candidates' })).toBeDefined();
    await ui.select({ key: 'composer-candidates', value: '1' });
    expect(suggested.at(-1)).toBe('Review the diff.');
    expect(sent).toEqual(['Run the tests.']);
    await ui.unmount();
  }
  await $.command.run({ command: 'composer', args: 'off', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-b', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(sent).toEqual(['Run the tests.']);
  // Explicit invocation works while OFF, including after a fresh/resumed session start.
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true });
  const config = files.get('/test/.claude/composer-autopilot/config.json');
  const before = suggested.length;
  await $.command.run({ command: 'composer', args: 'once', origin: { kind: 'composer' } });
  await clock.advance(200);
  expect(suggested.length).toBe(before + 1);
  expect(logs.at(-1)).toMatch('suggestions ready');
  const picker = await $.ui.mount({ plugin: 'composer-autopilot', surface: 'terminal', component: 'AbovePrompt', props: {
    hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 }, view: {}
  } });
  await picker.select({ key: 'composer-candidates', value: '2' });
  expect(suggested.at(-1)).toBe('Commit the change.');
  await picker.unmount();
  expect(files.get('/test/.claude/composer-autopilot/config.json')).toBe(config);
  expect(sent).toEqual(['Run the tests.']);
  await $.command.run({ command: 'composer', args: 'status', origin: { kind: 'composer' } });
  expect(logs.at(-1)).toMatch('OFF for');
  expect(logs.at(-1)).toMatch('Last: one-shot suggested');
});
