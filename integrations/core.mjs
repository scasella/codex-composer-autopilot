import { cacheUsage, cacheStatus } from './cache.mjs';

// Shared, dependency-free policy. Host adapters own context, storage, and submission.
export const HELP = 'composer on [here|all|SESSION_ID ...] | off [here|SESSION_ID ...] | status | sessions | mode suggest|auto | model [session|MODEL] | models | effort [default|low|medium|high|xhigh|max] | suggestions [N] | limit N';
export const defaults = () => ({ version: 5, enabled: false, mode: 'selected', delivery: 'suggest', predictionModel: 'session', predictionEffort: 'default', suggestionCount: 1, sessions: [], exclude: [], limit: 10, revision: 'initial' });
export function sessionId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) throw Error('Use a complete session ID from composer sessions.');
  return id;
}
export function validateConfig(c) {
  if (!c || ![1, 2, 3, 4, 5].includes(c.version) || typeof c.enabled !== 'boolean' || !['selected', 'all'].includes(c.mode) ||
    !Array.isArray(c.sessions) || !Array.isArray(c.exclude) || typeof c.revision !== 'string' ||
    !Number.isInteger(c.limit) || c.limit < 1 || c.limit > 1000) throw Error('Invalid Composer settings; restore a valid config before enabling.');
  if ((c.version >= 2 || c.delivery !== undefined) && !['auto', 'suggest'].includes(c.delivery)) throw Error('Invalid Composer delivery mode.');
  if (c.version >= 3 || c.predictionModel !== undefined) modelName(c.predictionModel);
  if (c.version >= 4 || c.predictionEffort !== undefined) effortName(c.predictionEffort);
  if (c.version >= 5 || c.suggestionCount !== undefined) suggestionCount(c.suggestionCount);
  c.sessions.forEach(sessionId); c.exclude.forEach(sessionId); return { ...c, version: 5, delivery: c.delivery ?? 'suggest', predictionModel: c.predictionModel ?? 'session', predictionEffort: c.predictionEffort ?? 'default', suggestionCount: c.suggestionCount ?? 1 };
}
export function modelName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@+\-]{0,255}$/.test(value)) throw Error('Use composer model session or a model ID from composer models.');
  return value;
}
function effortName(value) {
  if (!['default', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)) throw Error('Use composer effort default|low|medium|high|xhigh|max.');
  return value;
}
function suggestionCount(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10) throw Error('Use composer suggestions N, where N is an integer from 1 to 10.');
  return value;
}
export const targeted = (c, id) => c.enabled && !c.exclude.includes(id) && (c.mode === 'all' || c.sessions.includes(id));
export function predictionRequest(exactPrompt, count = 1) {
  suggestionCount(count);
  if (count > 1) return exactPrompt + '\n\nFor this request, propose up to ' + count + ' distinct likely next user messages, ranked most likely first. Apply the prediction rules above to each candidate. Return fewer when appropriate, or an empty array to abstain. Each candidate must be one nonempty line of at most 240 characters. Return only JSON matching this schema: ' + JSON.stringify({ type: 'object', properties: { suggestions: { type: 'array', items: { type: 'string' }, maxItems: count, uniqueItems: true } }, required: ['suggestions'], additionalProperties: false }) + '.';
  return exactPrompt + '\n\nReturn only JSON matching this schema: {"type":"object","properties":{"suggestion":{"type":["string","null"]}},"required":["suggestion"],"additionalProperties":false}.';
}
export function parseSuggestion(text) {
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'suggestion')) throw Error('Invalid prediction object.');
  const s = value.suggestion;
  if (s === null) return null;
  if (typeof s !== 'string' || !s.trim() || [...s].length > 240 || /[\r\n\u2028\u2029]/u.test(s)) throw Error('Prediction must be one nonempty line of at most 240 characters.');
  return s;
}
export function parseSuggestions(text, count = 1) {
  suggestionCount(count);
  if (count === 1) { const s = parseSuggestion(text); return s === null ? [] : [s]; }
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.suggestions) || value.suggestions.length > count) throw Error('Invalid prediction candidates.');
  const candidates = value.suggestions.map(s => {
    if (s === null) throw Error('Invalid prediction candidate.');
    return parseSuggestion(JSON.stringify({ suggestion: s }));
  });
  const seen = new Set();
  return candidates.filter(s => { const key = s.trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function createController(store, nonce = () => crypto.randomUUID()) {
  const config = async () => validateConfig((await store.get('config')) ?? defaults());
  let busy = false;
  const recordKey = id => `session-${sessionId(id)}`;
  async function read(id) {
    const s = (await store.get(recordKey(id))) ?? { id, count: 0, source: null, status: 'idle' };
    if (s.id !== id || !Number.isInteger(s.count) || s.count < 0 ||
      !['idle', 'predicting', 'reserved', 'submitted', 'suggested', 'cancelled', 'abstained', 'halted'].includes(s.status)) throw Error('Invalid session state; automatic sending stopped.');
    return s;
  }
  async function register(id, cwd) {
    const state = await read(id);
    await store.set(recordKey(id), { ...state, id, cwd, updatedAt: Date.now() });
  }
  async function command(args, id, cwd) {
    sessionId(id);
    const [action = 'status', ...targets] = args.trim().split(/\s+/).filter(Boolean);
    const c = await config();
    if (action === 'sessions') {
      const records = await Promise.all((await store.keys()).filter(k => k.startsWith('session-')).map(k => store.get(k)));
      return records.filter(Boolean).map(s => `${s.id}  ${s.status}  ${s.cwd ?? ''}`).join('\n') || 'No sessions have registered yet.';
    }
    if (action === 'status' || (['model', 'effort', 'suggestions'].includes(action) && !targets.length)) {
      const state = await read(id);
      const manual = await store.get(`once-${id}`);
      const last = manual && manual.updatedAt >= (state.predictionAt ?? 0) ? manual : state;
      const paused = state.revision === c.revision && (state.status === 'halted' || (c.delivery === 'auto' && state.count >= c.limit));
      return `${!targeted(c, id) ? 'OFF' : paused ? 'PAUSED' : 'ON'} for ${id}\nDelivery: ${c.delivery === 'suggest' ? 'suggest — Tab to accept, Enter to send' : 'auto — send automatically'}\nComposer model: ${c.predictionModel === 'session' ? 'session (coding model)' : c.predictionModel}\nComposer effort: ${c.predictionEffort}\nSuggestions: ${c.suggestionCount} (auto mode always uses one)\nScope: ${c.mode === 'all' ? 'all loaded sessions' : c.sessions.join(', ') || 'none'}\nExcluded: ${c.exclude.join(', ') || 'none'}\nLimit: ${c.limit} automatic follow-ups per session between user messages.\nCache (last prediction): ${cacheStatus(last.cache)}\nLast: ${last === manual ? 'one-shot ' : ''}${last.status}${last.error ? ' — ' + last.error : ''}`;
    }
    const ids = targets.map(x => x === 'here' ? id : x);
    if (action === 'on') {
      c.enabled = true;
      if (ids.length === 1 && ids[0] === 'all') c.mode = 'all';
      else {
        c.mode = 'selected'; c.sessions = [...new Set((ids.length ? ids : [id]).map(sessionId))];
        c.exclude = c.exclude.filter(x => !c.sessions.includes(x));
      }
    } else if (action === 'off') {
      if (!ids.length || (ids.length === 1 && ids[0] === 'all')) c.enabled = false;
      else c.exclude = [...new Set([...c.exclude, ...ids.map(sessionId)])];
    } else if (action === 'mode' && ids.length === 1 && ['auto', 'suggest'].includes(ids[0])) c.delivery = ids[0];
    else if (action === 'model' && targets.length === 1) c.predictionModel = modelName(targets[0]);
    else if (action === 'effort' && targets.length === 1) c.predictionEffort = effortName(targets[0]);
    else if (action === 'suggestions' && targets.length === 1 && /^\d+$/.test(targets[0])) c.suggestionCount = suggestionCount(Number(targets[0]));
    else if (action === 'limit' && ids.length === 1) c.limit = Number(ids[0]);
    else throw Error(HELP);
    c.revision = nonce(); validateConfig(c); await store.set('config', c);
    await register(id, cwd);
    return `${await command('status', id, cwd)}\nSettings apply to this harness only; other loaded sessions read them before submitting.`;
  }
  async function human(id) {
    const s = await read(id); await store.set(recordKey(id), { ...s, count: 0 });
  }
  async function run({ id, source, cwd, current, predict, submit, suggest, supportsSuggestions = true, once = false }) {
    if (busy) return 'busy';
    if (!source && !once) return;
    const key = once ? `once-${sessionId(id)}` : recordKey(id);
    busy = true;
    let state, revision;
    try {
      const c = await config(); revision = c.revision;
      if (once) c.delivery = 'suggest';
      if ((!once && !targeted(c, id)) || (c.delivery === 'suggest' && !supportsSuggestions) || !await current()) return 'unavailable';
      state = once ? { id, count: 0, status: 'idle' } : await read(id);
      if (state.revision !== revision) state = { ...state, revision, count: 0, error: undefined, status: 'idle' };
      if (!once && (state.source === source || state.status === 'halted' || (c.delivery === 'auto' && state.count >= c.limit))) return;
      state = { ...state, id, source, cwd, status: 'predicting', cache: null, predictionAt: Date.now(), updatedAt: Date.now() };
      // Reserve before the model call; reloads and ambiguous submissions never replay this source.
      await store.set(key, state);
      const count = c.delivery === 'suggest' ? c.suggestionCount : 1;
      const raw = await predict(c.predictionModel, c.predictionEffort, count, usage => { state.cache = cacheUsage(usage); });
      if (raw === null) throw Error(once ? 'Prediction model did not answer. Run composer once to retry.' : 'Prediction model did not answer. Run composer on to retry on a future turn.');
      const candidates = parseSuggestions(raw, count), text = candidates[0];
      const latest = await config();
      if (latest.revision !== revision || (!once && !targeted(latest, id)) || !await current()) state.status = 'cancelled';
      else if (!candidates.length) state.status = 'abstained';
      else {
        state = { ...state, count: state.count + (c.delivery === 'auto' ? 1 : 0), status: 'reserved' };
        await store.set(key, state);
        const final = await config();
        if (final.revision !== revision || (!once && !targeted(final, id)) || !await current()) state.status = 'cancelled';
        else if (c.delivery === 'suggest') {
          // The adapter may retain this guard until the user presses Tab.
          const valid = async () => {
            const now = await config();
            return now.revision === revision && (once || (targeted(now, id) && now.delivery === 'suggest')) && await current();
          };
          state.status = await suggest(text, valid, candidates) === false ? 'cancelled' : 'suggested';
        } else { await submit(text); state.status = 'submitted'; }
      }
      await store.set(key, { ...state, updatedAt: Date.now() });
      return state.status;
    } catch (e) {
      if (state) await store.set(key, { ...state, revision, status: 'halted', error: String(e), updatedAt: Date.now() });
      throw e;
    } finally { busy = false; }
  }
  return { command, register, human, run };
}
