import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CDP, targets } from './cdp.mjs';
import { createAdapter } from './adapter.mjs';
import { createEngine } from './engine.mjs';

export const slot = 'globalThis.__localComposerAutopilot_v1';
export const supportedVersion = '26.1007.30912';
export function appInfo() {
  if (process.platform !== 'darwin') throw Error('The current adapter supports macOS only.');
  const app = process.env.CODEX_APP_PATH ?? ['/Applications/ChatGPT.app', '/Applications/Codex.app'].find(fs.existsSync);
  if (!app) throw Error('Codex desktop was not found. Set CODEX_APP_PATH to its .app path.');
  const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleShortVersionString', `${app}/Contents/Info.plist`],
    { encoding: 'utf8', timeout: 3000 }).trim();
  return { app, version, supported: version === supportedVersion };
}
export async function connect(port) {
  const list = (await targets(port)).filter(t => t.type === 'page' && t.url === 'app://-/index.html');
  if (list.length !== 1) throw Error(`Expected one main Codex renderer; found ${list.length}. Close extra main windows or check the debugging port.`);
  return CDP.connect(list[0].webSocketDebuggerUrl, port);
}
export const inspect = cdp => cdp.evaluate(`(async()=>{const api=await (${createAdapter.toString()})();return {chats:api.list(),ui:api.ui()}})()`);
export async function install(cdp, token, config) {
  return cdp.evaluate(`(async()=>{
    if (${slot}?.snapshot().enabled) throw Error('Another Composer Autopilot controller is active. Turn it off before starting this copy.');
    const api = await (${createAdapter.toString()})();
    const engine = (${createEngine.toString()})(api, ${JSON.stringify(token)});
    engine.configure(${JSON.stringify(config)}); ${slot} = engine; return engine.snapshot();
  })()`);
}
export function requireSupported() {
  const info = appInfo();
  if (!info.supported) throw Error(`Unsupported Codex build ${info.version}; adapter supports ${supportedVersion}. Nothing was sent.`);
  return info;
}
