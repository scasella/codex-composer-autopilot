#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

export class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const msg = JSON.parse(String(event.data));
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Renderer connection closed')); }
      this.pending.clear();
    });
  }
  static async connect(url, expectedPort) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      || parsed.port !== String(expectedPort)) throw new Error('Refusing a non-local or unexpected debugging endpoint');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket connection timeout')); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')); }, { once: true });
    });
    return new CDP(socket);
  }
  call(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true,
      userGesture: false });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

export async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`Target discovery returned HTTP ${response.status}`);
  return response.json();
}

export function foreground() {
  if (process.platform !== 'darwin') throw new Error('Composer Autopilot requires macOS');
  const script = `ObjC.import('AppKit'); var a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(a.processIdentifier),bundle:ObjC.unwrap(a.bundleIdentifier),name:ObjC.unwrap(a.localizedName)})`;
  const app = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 5000 }).trim());
  if (!Number.isInteger(app.pid) || !app.name) throw new Error('Cannot audit the foreground app from this environment; run in your local Terminal');
  return app;
}
