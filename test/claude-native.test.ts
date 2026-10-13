import { test, expect, mock } from 'claude-code/testing';

test('native mod loads, controls targets, forks, and submits exact prediction', async ($, on) => {
  const files = new Map<string,string>();
  const sent: string[] = [];
  const logs: string[] = [];
  const clock = mock.clock(on);
  mock.env(on, { HOME: '/test' });
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('turn.complete', async (_$, e) => ({ text: e.answer }));
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) }));
  on('fs.read', async (_$, e) => ({ value: e.path.endsWith('composer-v5.txt') ? 'EXACT_TEST_PROMPT' : files.get(e.path) }));
  on('fs.write', async (_$, e) => { files.set(e.path,e.text); return { value: undefined }; });
  on('session.id', async () => ({ value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  on('session.cwd', async () => ({ value: '/project' }));
  on('command.register', async () => ({ value: undefined }));
  on('ui.log', async (_$, e) => { logs.push(e.text); return { value: undefined }; });
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }));
  on('model.fork', async (_$, e) => {
    expect(e.prompt).toStartWith('EXACT_TEST_PROMPT\n\n');
    return { value: { text: '{"suggestion":"Run the tests."}', usage: {} } };
  });
  on('prompt.submit', async (_$, e) => { sent.push(e.text); return { text: e.text }; });
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true });
  await $.command.run({ command: 'composer', args: 'on all', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-a', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(logs.join('\n')).toMatch('ON for');
  expect(sent).toEqual(['Run the tests.']);
  await $.command.run({ command: 'composer', args: 'off', origin: { kind: 'composer' } });
  await $.turn.complete({ turnId: 'turn-b', reason: 'answer', isAborted: false, answer: 'Done.', durationMs: 1 });
  await clock.advance(200);
  expect(sent).toEqual(['Run the tests.']);
});
