import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function nodeStore(root = process.env.COMPOSER_PI_HOME ?? path.join(os.homedir(), '.pi', 'agent', 'composer-autopilot')) {
  const file = key => path.join(root, key + '.json');
  return {
    async get(key) {
      try { return JSON.parse(await fs.readFile(file(key), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
    },
    async set(key, value) {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const temp = file(key) + '.' + randomUUID();
      try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, file(key)); }
      finally { await fs.rm(temp, { force: true }); }
    },
    async keys() {
      try { return (await fs.readdir(root)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)); }
      catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    }
  };
}
