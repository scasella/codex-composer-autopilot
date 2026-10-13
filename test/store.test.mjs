import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, validate, defaults } from '../src/store.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-autopilot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createStore(dir);
}
test('new installations default to an empty selection', t => assert.deepEqual(fixture(t).config(), defaults));
test('targets and exclusions survive a fresh store instance', t => {
  const s = fixture(t); s.write('config.json', validate({ ...defaults, threads: [id], exclude: [id] }));
  assert.deepEqual(createStore(s.dir).config(), { ...defaults, threads: [id], exclude: [id] });
});
test('a reserved but unconfirmed send survives a restart', t => {
  const s = fixture(t); s.write('ledger.json', { 'local/id/turn': { status: 'reserved' } });
  assert.equal(createStore(s.dir).read('ledger.json')['local/id/turn'].status, 'reserved');
  assert.equal(fs.statSync(s.file('ledger.json')).mode & 0o777, 0o600);
});
test('corrupt state fails closed', t => {
  const s = fixture(t); fs.writeFileSync(s.file('ledger.json'), '{broken');
  assert.throws(() => s.read('ledger.json', {}), /Cannot read/);
});
test('locks prevent a second live owner and can be released', t => {
  const s = fixture(t), release = s.lock('daemon.lock', 'first');
  assert.throws(() => s.lock('daemon.lock', 'second'), /already running/);
  release(); const releaseAgain = s.lock('daemon.lock', 'second'); releaseAgain();
});
test('invalid scopes, IDs and ports fail validation', () => {
  for (const patch of [{ mode:'everything' }, { threads:['typo'] }, { exclude:[''] }, { port:80 }, { port:NaN }])
    assert.throws(() => validate({ ...defaults, ...patch }));
});
