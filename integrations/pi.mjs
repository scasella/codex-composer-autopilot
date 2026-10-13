import fs from 'node:fs/promises';
import { createController, predictionRequest, modelName, HELP } from './core.mjs';
import { cachePiHistory } from './cache.mjs';
import { nodeStore } from './node-store.mjs';

function predictionModel(ctx, choice) {
  if (choice === 'session') return ctx.model;
  modelName(choice);
  const slash = choice.indexOf('/');
  if (slash < 1) throw Error('Pi needs provider/model-id. Run /composer models to list choices.');
  const model = ctx.modelRegistry.find(choice.slice(0, slash), choice.slice(slash + 1));
  if (!model) throw Error(`Unknown Composer model: ${choice}. Run /composer models.`);
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw Error(`No configured credentials for Composer model: ${choice}.`);
  return model;
}

export default function composer(pi) {
  const control = createController(nodeStore());
  let epoch = 0, dialog = 0, abort, offer, unsubscribe;
  const clearOffer = () => { offer?.ui.setWidget('composer-suggestion', undefined); offer = undefined; };
  const drawOffer = () => { if (offer) offer.ui.setWidget('composer-suggestion', [`${offer.candidates.length > 1 ? `↑/↓ ${offer.index + 1}/${offer.candidates.length} · ` : ''}Tab to accept · ${offer.candidates[offer.index]}`]); };
  const cancel = () => { epoch++; abort?.abort(); clearOffer(); };
  const id = ctx => ctx.sessionManager.getSessionId();
  const report = (ctx, e) => ctx.ui.notify(`Composer paused: ${String(e)}`, 'error');
  pi.registerCommand('composer', {
    description: HELP,
    handler: async (args, ctx) => {
      cancel();
      try {
        const parts = args.trim().split(/\s+/);
        if (parts[0] === 'models' && parts.length === 1) {
          const models = ctx.modelRegistry.getAvailable().map(m => `${m.provider}/${m.id}`).sort();
          ctx.ui.notify(['session (coding model)', ...models].join('\n'), 'info');
          return;
        }
        if (parts[0] === 'model' && parts.length === 2) predictionModel(ctx, parts[1]);
        ctx.ui.notify(await control.command(args, id(ctx), ctx.cwd), 'info');
      }
      catch (e) { report(ctx, e); }
    }
  });
  for (const name of ['session_start', 'session_switch', 'session_fork']) pi.on(name, async (_e, ctx) => {
    cancel(); unsubscribe?.();
    unsubscribe = ctx.ui.onTerminalInput?.(data => {
      // Focus reports and key releases are not edits (including Tab release).
      if (data === '\x1b[I' || data === '\x1b[O' || /^\x1b\[[\d;:]*:3[uA-Z~]$/.test(data)) return;
      const tab = data === '\t' || /^\x1b\[9(?:;1(?::[12])?)?u$/.test(data);
      const direction = /^(?:\x1b\[A|\x1bOA|\x1b\[1;1(?::[12])?A|\x1b\[57352(?:;1(?::[12])?)?u)$/.test(data) ? -1 :
        /^(?:\x1b\[B|\x1bOB|\x1b\[1;1(?::[12])?B|\x1b\[57353(?:;1(?::[12])?)?u)$/.test(data) ? 1 : 0;
      if (direction && offer?.candidates.length > 1 && !ctx.ui.getEditorText().trim()) {
        const pending = offer;
        pending.index = (pending.index + direction + pending.candidates.length) % pending.candidates.length;
        void (async () => {
          if (offer !== pending) return;
          if (!await pending.valid()) { if (offer === pending) clearOffer(); return; }
          if (offer === pending) drawOffer();
        })().catch(error => { if (offer === pending) clearOffer(); report(ctx, error); });
        return { consume: true };
      }
      if (tab && offer && !ctx.ui.getEditorText().trim()) {
        const pending = offer, text = offer.candidates[offer.index], generation = epoch;
        clearOffer();
        void (async () => {
          if (await pending.valid() && epoch === generation && !ctx.ui.getEditorText().trim()) ctx.ui.setEditorText(text);
        })().catch(error => report(ctx, error));
        return { consume: true };
      }
      // Ordinary typing, Escape, and Enter dismiss a preview, never accept it.
      cancel();
    });
    try { await control.register(id(ctx), ctx.cwd); } catch (e) { report(ctx, e); }
  });
  for (const name of ['session_before_switch', 'session_before_fork', 'session_before_tree']) pi.on(name, cancel);
  pi.on('session_shutdown', () => { cancel(); unsubscribe?.(); });
  pi.on('input', async (e, ctx) => {
    cancel();
    if (e.source !== 'extension') {
      try { await control.human(id(ctx)); } catch (error) { report(ctx, error); }
    }
  });
  pi.on('ui_prompt_start', () => { dialog++; cancel(); });
  pi.on('ui_prompt_end', () => { dialog = Math.max(0, dialog - 1); });
  pi.on('agent_before_settle', async (event, ctx) => {
    if (event.outcome !== 'completed' || event.continue || event.context.pendingMessages.length || !ctx.model) return;
    const session = id(ctx), source = ctx.sessionManager.getLeafId(), generation = epoch;
    abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(45000), ...ctx.signal ? [ctx.signal] : []]);
    let finished = false;
    const current = () => epoch === generation && (finished || !signal.aborted) && !dialog &&
      id(ctx) === session && ctx.sessionManager.getLeafId() === source &&
      !ctx.hasPendingMessages() && !ctx.ui.getEditorText().trim();
    try {
      await control.run({ id: session, source, cwd: ctx.cwd, current, supportsSuggestions: Boolean(ctx.hasUI && unsubscribe),
        async predict(choice, effort, count, reportUsage) {
          const model = predictionModel(ctx, choice);
          const exact = await fs.readFile(new URL('../prompts/composer-v5.txt', import.meta.url), 'utf8');
          const stream = ctx.modelRegistry.streamSimple(model, {
            systemPrompt: ctx.getSystemPrompt(), messages: [...event.context.llmMessages,
              { role: 'user', content: [{ type: 'text', text: predictionRequest(exact, count) }], timestamp: Date.now() }]
          }, { reasoning: effort === 'default' ? 'high' : effort, maxTokens: 4096, signal, sessionId: `composer-${session}`, onPayload: cachePiHistory });
          const result = await stream.result();
          reportUsage({ read: result.usage?.cacheRead, write: result.usage?.cacheWrite });
          if (['error', 'aborted'].includes(result.stopReason)) return null;
          return result.content.filter(x => x.type === 'text').map(x => x.text).join('');
        },
        suggest(text, valid, candidates) {
          finished = true;
          clearOffer();
          offer = { candidates, index: 0, valid, ui: ctx.ui };
          drawOffer();
          return true;
        },
        submit(text) { pi.sendUserMessage(text, { deliverAs: 'followUp', expandPromptTemplates: false }); }
      });
    } catch (e) { if (!signal.aborted) report(ctx, e); }
    finally { abort = undefined; }
  });
}
