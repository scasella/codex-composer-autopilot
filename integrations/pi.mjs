import fs from 'node:fs/promises';
import { createController, predictionRequest, HELP } from './core.mjs';
import { nodeStore } from './node-store.mjs';

export default function composer(pi) {
  const control = createController(nodeStore());
  let epoch = 0, dialog = 0, abort, offer, unsubscribe;
  const clearOffer = () => { offer?.ui.setWidget('composer-suggestion', undefined); offer = undefined; };
  const cancel = () => { epoch++; abort?.abort(); clearOffer(); };
  const id = ctx => ctx.sessionManager.getSessionId();
  const report = (ctx, e) => ctx.ui.notify(`Composer paused: ${String(e)}`, 'error');
  pi.registerCommand('composer', {
    description: HELP,
    handler: async (args, ctx) => {
      cancel();
      try { ctx.ui.notify(await control.command(args, id(ctx), ctx.cwd), 'info'); }
      catch (e) { report(ctx, e); }
    }
  });
  for (const name of ['session_start', 'session_switch', 'session_fork']) pi.on(name, async (_e, ctx) => {
    cancel(); unsubscribe?.();
    unsubscribe = ctx.ui.onTerminalInput?.(data => {
      // Focus reports and key releases are not edits (including Tab release).
      if (data === '\x1b[I' || data === '\x1b[O' || /^\x1b\[[\d;:]*:3[uA-Z~]$/.test(data)) return;
      const tab = data === '\t' || /^\x1b\[9(?:;1(?::[12])?)?u$/.test(data);
      if (tab && offer && !ctx.ui.getEditorText().trim()) {
        const pending = offer, generation = epoch;
        clearOffer();
        void (async () => {
          if (await pending.valid() && epoch === generation && !ctx.ui.getEditorText().trim()) ctx.ui.setEditorText(pending.text);
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
        async predict() {
          const exact = await fs.readFile(new URL('../prompts/composer-v5.txt', import.meta.url), 'utf8');
          const stream = ctx.modelRegistry.streamSimple(ctx.model, {
            systemPrompt: ctx.getSystemPrompt(), messages: [...event.context.llmMessages,
              { role: 'user', content: [{ type: 'text', text: predictionRequest(exact) }], timestamp: Date.now() }]
          }, { reasoning: 'high', maxTokens: 4096, signal, sessionId: `composer-${session}` });
          const result = await stream.result();
          if (['error', 'aborted'].includes(result.stopReason)) return null;
          return result.content.filter(x => x.type === 'text').map(x => x.text).join('');
        },
        suggest(text, valid) {
          finished = true;
          clearOffer();
          offer = { text, valid, ui: ctx.ui };
          ctx.ui.setWidget('composer-suggestion', [`Tab to accept · ${text}`]);
          return true;
        },
        submit(text) { pi.sendUserMessage(text, { deliverAs: 'followUp', expandPromptTemplates: false }); }
      });
    } catch (e) { if (!signal.aborted) report(ctx, e); }
    finally { abort = undefined; }
  });
}
