import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/autopilot.mjs', import.meta.url));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8',
    env: { ...process.env, COMPOSER_AUTOPILOT_HOME: dir } });
}
test('status is off without installation side effects', t => {
  const run = fixture(t), result = run('status', '--json'); assert.equal(result.status, 0);
  const s = JSON.parse(result.stdout); assert.equal(s.enabled, false); assert.deepEqual(s.config.threads, []);
});
test('include and exclude persist without enabling sending', t => {
  const run = fixture(t);
  assert.equal(run('include', id).status, 0); assert.equal(run('exclude', id).status, 0);
  let s = JSON.parse(run('status', '--json').stdout);
  assert.deepEqual(s.config.threads, [id]); assert.deepEqual(s.config.exclude, [id]); assert.equal(s.enabled, false);
  run('include', id); s = JSON.parse(run('status', '--json').stdout); assert.deepEqual(s.config.exclude, []);
});
test('on requires a target scope before touching the desktop', t => {
  const result = fixture(t)('on'); assert.notEqual(result.status, 0); assert.match(result.stderr, /Choose --all/);
});
test('conflicting selection options and malformed IDs are rejected', t => {
  const run = fixture(t); assert.notEqual(run('on','--all','--thread',id).status,0);
  assert.notEqual(run('exclude','not-a-uuid').status,0);
});
test('help does not require macOS or the desktop app', t => {
  const r = fixture(t)('--help'); assert.equal(r.status, 0); assert.match(r.stdout, /--thread/);
});
