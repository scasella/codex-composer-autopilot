async function makeControl($) {
    const base = await $.env.get('COMPOSER_CLAUDE_HOME') ?? `${await $.env.get('HOME')}/.claude/composer-autopilot`;
    return createController({
      async get(key) {
        const path = `${base}/${key}.json`;
        return await $.fs.exists(path) ? JSON.parse(await $.fs.read(path)) : undefined;
      },
      async set(key, value) { await $.fs.write(`${base}/${key}.json`, JSON.stringify(value)); },
      async keys() {
        if (!await $.fs.exists(base)) return [];
        return (await $.fs.list(base)).filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name.slice(0, -5));
      }
    });
  }

import { createController, predictionRequest, HELP } from '../integrations/core.mjs';

export function register(on) {
  let control, epoch = 0, running = null, queued = 0, lastTurn = null, timer, interactive = false;
  const cancel = () => { epoch++; timer?.cancel(); timer = undefined; };
  on('session.start', async ($, e, next) => {
    cancel(); interactive = e.isInteractive === true;
    await ((control ??= await makeControl($))).register(await $.session.id(), await $.session.cwd());
    await $.command.register({ name: 'composer', description: HELP, argumentHint: 'on|off|mode suggest|auto|status|sessions', immediate: true });
    return next(e);
  });
  on('command.run', { command: 'composer' }, async ($, e) => {
    cancel();
    try { await $.ui.log(await ((control ??= await makeControl($))).command(e.args, await $.session.id(), await $.session.cwd())); }
    catch (error) { await $.ui.log(`Composer: ${String(error)}`); }
    return {};
  });
  on('session.end', async (_$, e, next) => { cancel(); running = null; queued = 0; lastTurn = null; return next(e); });
  on('prompt.edit', async (_$, e, next) => { cancel(); return next(e); });
  on('prompt.submit', async ($, e, next) => {
    cancel();
    if (e.turnId) queued++;
    if (['composer', 'bridge', 'sdk'].includes(e.origin?.kind)) await ((control ??= await makeControl($))).human(await $.session.id());
    return next(e);
  });
  on('turn.start', async (_$, e, next) => {
    cancel(); running = e.turnId; queued = Math.max(0, queued - 1); return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;
    running = null; lastTurn = e.turnId;
    if (e.isAborted || e.reason !== 'answer' || queued || !e.answer?.trim()) return result;
    cancel(); const generation = epoch;
    // Let the host finish settlement; no foreground or prompt-box writes.
    timer = $.clock.after(100, async () => {
      try {
        const id = await $.session.id(), cwd = await $.session.cwd();
        const current = async () => generation === epoch && !running && !queued && lastTurn === e.turnId &&
          await $.session.id() === id && !(await $.prompt.read()).text.trim();
        await ((control ??= await makeControl($))).run({ id, source: e.turnId, cwd, current, supportsSuggestions: interactive,
          async predict() {
            const exact = await $.fs.read(`${$.plugin.root}/prompts/composer-v5.txt`);
            const response = await $.model.fork({ prompt: predictionRequest(exact) });
            return response?.text ?? null;
          },
          async suggest(text) { return (await $.prompt.suggest({ text })).isShown; },
          async submit(text) {
            const response = await $.prompt.submit({ text });
            if (response.drop) throw Error(`Submission refused: ${response.drop}`);
          }
        });
      } catch (error) { await $.ui.log(`Composer paused: ${String(error)}`); }
    });
    return result;
  });
}
