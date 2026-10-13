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
import { transcriptRequest, completionText } from '../integrations/claude-context.mjs';

export function register(on) {
  let control, epoch = 0, running = null, queued = 0, lastTurn = null, timer, interactive = false, offer, redraw = () => {};
  const cancel = () => { epoch++; timer?.cancel(); timer = undefined; if (offer) { offer = undefined; redraw(); } };
  on('session.start', async ($, e, next) => {
    cancel(); redraw = () => $.ui.invalidate('ui.render'); interactive = e.isInteractive === true;
    await ((control ??= await makeControl($))).register(await $.session.id(), await $.session.cwd());
    await $.command.register({ name: 'composer', description: HELP, argumentHint: 'on|off|mode|model|models|effort|suggestions|status|sessions', immediate: true });
    return next(e);
  });
  on('command.run', { command: 'composer' }, async ($, e) => {
    cancel();
    if (e.args.trim() === 'models') {
      await $.ui.log('session (coding model)\nhaiku\nsonnet\nopus\nOr a full Claude model ID supported by your provider. Availability is checked by Claude when predicting.');
      return {};
    }
    try { await $.ui.log(await ((control ??= await makeControl($))).command(e.args, await $.session.id(), await $.session.cwd())); }
    catch (error) { await $.ui.log(`Composer: ${String(error)}`); }
    return {};
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const base = await next(e), pending = offer;
    if (e.props?.hasSurvey || e.props?.isWorking || e.props?.view?.agentId || !pending || !await pending.valid() || offer !== pending) return base;
    const t = $.ui.resolve(e);
    if (!t.Select) return base;
    return t.Box({ flexDirection: 'column', children: [base,
      t.Text({ dimColor: true, children: 'Composer · Ctrl+X Tab to focus · ↑/↓ browse · Enter choose · Esc then Tab to accept' }),
      t.Select({ key: 'composer-candidates', label: 'Suggestions', autoFocus: true,
        options: pending.candidates.map((text, index) => ({ value: String(index), label: `${index + 1}. ${text}` })), value: String(pending.index),
        onSelect: async value => {
          try {
            const index = Number(value);
            if (!Number.isInteger(index) || index < 0 || index >= pending.candidates.length || offer !== pending) return;
            if (!await pending.valid() || offer !== pending) { if (offer === pending) { offer = undefined; redraw(); } return; }
            pending.index = index;
            await $.prompt.suggest({ text: pending.candidates[index] });
            redraw();
          } catch (error) { cancel(); await $.ui.log(`Composer paused: ${String(error)}`); }
        }
      })
    ] });
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
          async predict(choice, effort, count, reportUsage) {
            const exact = await $.fs.read(`${$.plugin.root}/prompts/composer-v5.txt`);
            if (choice !== 'session' || effort !== 'default') {
              const model = choice === 'session' ? await $.session.model() : choice;
              if (typeof model !== 'string' || !model.trim()) throw Error('Unable to resolve the Composer model.');
              const prompt = transcriptRequest(exact, await $.session.messages(), count);
              const response = await $.model.complete({ model, prompt, maxTokens: 4096, timeoutMs: 45000, ...(effort === 'default' ? {} : { effort }) });
              reportUsage({ read: response?.usage?.cache_read_input_tokens, write: response?.usage?.cache_creation_input_tokens });
              return completionText(response);
            }
            const response = await $.model.fork({ prompt: predictionRequest(exact, count) });
            reportUsage({ read: response?.usage?.cache_read_input_tokens, write: response?.usage?.cache_creation_input_tokens });
            return completionText(response, { legacyFork: true });
          },
          async suggest(text, valid, candidates) {
            const shown = (await $.prompt.suggest({ text })).isShown;
            if (shown && candidates.length > 1 && await valid()) { offer = { candidates, index: 0, valid }; redraw(); }
            return shown;
          },
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
