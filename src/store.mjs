import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const defaults = { mode: 'selected', threads: [], exclude: [], port: 9222 };
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const alive = pid => {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
export function validate(config) {
  if (!['all', 'selected'].includes(config.mode)) throw Error('Invalid target mode');
  for (const key of ['threads', 'exclude']) {
    if (!Array.isArray(config[key]) || config[key].some(x => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x)))
      throw Error(`${key} must contain full thread UUIDs. Use the threads command to list them.`);
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw Error('Invalid debugging port');
  return { mode: config.mode, threads: [...new Set(config.threads)], exclude: [...new Set(config.exclude)], port: config.port };
}
export function createStore(dir = process.env.COMPOSER_AUTOPILOT_HOME ??
  path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'codex-composer-autopilot')) {
  dir = path.resolve(dir);
  const file = name => path.join(dir, name);
  const ensure = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const read = (name, fallback = null) => {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw Error(`Cannot read ${name}: ${e.message}`); }
  };
  const write = (name, value) => {
    ensure(); const tmp = file(`${name}.${randomUUID()}.tmp`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file(name));
  };
  return {
    dir, file, ensure, read, write,
    config: () => validate(read('config.json', defaults)),
    event(value) {
      ensure(); const log = file('events.jsonl');
      // Receipts are kept in ledger.json. Bound the human-readable activity log.
      if (fs.existsSync(log) && fs.statSync(log).size > 1024 * 1024) fs.renameSync(log, file('events.previous.jsonl'));
      fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 });
    },
    lock(name, token) {
      ensure();
      const existing = read(name);
      if (existing && alive(existing.pid)) throw Error('A controller or control command is already running.');
      if (existing) fs.unlinkSync(file(name));
      const fd = fs.openSync(file(name), 'wx', 0o600);
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, token })); } finally { fs.closeSync(fd); }
      return () => { if (read(name)?.token === token) fs.unlinkSync(file(name)); };
    }
  };
}
