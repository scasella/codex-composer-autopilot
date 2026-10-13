import fs from 'node:fs/promises';
import { createController, predictionRequest, HELP } from './core.mjs';
import { nodeStore } from './node-store.mjs';

export default function composer(pi) {
  const control = createController(nodeStore());
  let epoch = 0, dialog = 0, abort;
  const cancel = () => { epoch++; abort?.abort(); };
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
    cancel();
    try { await control.register(id(ctx), ctx.cwd); } catch (e) { report(ctx, e); }
  });
  for (const name of ['session_before_switch', 'session_before_fork', 'session_before_tree', 'session_shutdown']) pi.on(name, cancel);
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
    const current = () => epoch === generation && !signal.aborted && !dialog &&
      id(ctx) === session && ctx.sessionManager.getLeafId() === source &&
      !ctx.hasPendingMessages() && !ctx.ui.getEditorText().trim();
    try {
      await control.run({ id: session, source, cwd: ctx.cwd, current,
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
        submit(text) { pi.sendUserMessage(text, { deliverAs: 'followUp', expandPromptTemplates: false }); }
      });
    } catch (e) { if (!signal.aborted) report(ctx, e); }
    finally { abort = undefined; }
  });
}
