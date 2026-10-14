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

async function predict($, choice, effort, count, reportUsage) {
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
}

async function generate($, control, { source, once, interactive, current, retain }) {
  const id = await $.session.id(), cwd = await $.session.cwd();
  const valid = async () => current() && await $.session.id() === id && !(await $.prompt.read()).text.trim();
  return control.run({ id, source, once, cwd, current: valid, supportsSuggestions: interactive,
    predict: (choice, effort, count, reportUsage) => predict($, choice, effort, count, reportUsage),
    async suggest(text, valid, candidates) {
      const shown = (await $.prompt.suggest({ text })).isShown;
      if (shown && candidates.length > 1 && await valid()) retain(candidates, valid);
      return shown;
    },
    async submit(text) {
      const response = await $.prompt.submit({ text });
      if (response.drop) throw Error(`Submission refused: ${response.drop}`);
    }
  });
}

export function register(on) {
  let control, epoch = 0, running = null, queued = 0, lastTurn = null, timer, interactive = false, offer, redraw = () => {};
  const cancel = () => { epoch++; timer?.cancel(); timer = undefined; if (offer) { offer = undefined; redraw(); } };
  const options = (source, generation, once = false) => ({
    source, once, interactive,
    current: () => generation === epoch && !running && !queued && lastTurn === source,
    retain(candidates, valid) { offer = { candidates, index: 0, valid }; redraw(); }
  });
  on('session.start', async ($, e, next) => {
    cancel(); redraw = () => $.ui.invalidate('ui.render'); interactive = e.isInteractive === true;
    await ((control ??= await makeControl($))).register(await $.session.id(), await $.session.cwd());
    await $.command.register({ name: 'composer', description: 'composer once | ' + HELP, argumentHint: 'once|on|off|mode|model|models|effort|suggestions|status|sessions', immediate: true });
    return next(e);
  });
  on('command.run', { command: 'composer' }, async ($, e) => {
    cancel();
    if (e.args.trim() === 'once') {
      if (!interactive || running || queued) {
        await $.ui.log('Composer once needs an idle interactive session. Try again after the coding turn finishes.');
        return {};
      }
      const generation = epoch, source = lastTurn;
      await $.ui.log('Composer: generating suggestions once…');
      // Return control to the empty prompt before displaying the native autocomplete.
      timer = $.clock.after(100, async () => {
        try {
          const status = await generate($, (control ??= await makeControl($)), options(source, generation, true));
          await $.ui.log({ suggested: 'Composer: suggestions ready — Tab to accept, Enter to send.',
            abstained: 'Composer: no grounded next message to suggest.',
            busy: 'Composer: a prediction is still running. Try /composer once again when it finishes.',
            cancelled: 'Composer: suggestion cancelled or the prompt could not display it. Run /composer once to retry.',
            unavailable: 'Composer: suggestion skipped because the session or prompt changed. Run /composer once when idle.'
          }[status] ?? 'Composer: no suggestion generated.');
        } catch (error) { await $.ui.log(`Composer once failed: ${String(error)}`); }
      });
      return {};
    }
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
        await generate($, (control ??= await makeControl($)), options(e.turnId, generation));
      } catch (error) { await $.ui.log(`Composer paused: ${String(error)}`); }
    });
    return result;
  });
}
