// Shared, dependency-free policy. Host adapters own context, storage, and submission.
export const HELP = 'composer on [here|all|SESSION_ID ...] | off [here|SESSION_ID ...] | status | sessions | mode suggest|auto | limit N';
export const defaults = () => ({ version: 2, enabled: false, mode: 'selected', delivery: 'auto', sessions: [], exclude: [], limit: 10, revision: 'initial' });
export function sessionId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) throw Error('Use a complete session ID from composer sessions.');
  return id;
}
export function validateConfig(c) {
  if (!c || ![1, 2].includes(c.version) || typeof c.enabled !== 'boolean' || !['selected', 'all'].includes(c.mode) ||
    !Array.isArray(c.sessions) || !Array.isArray(c.exclude) || typeof c.revision !== 'string' ||
    !Number.isInteger(c.limit) || c.limit < 1 || c.limit > 1000) throw Error('Invalid Composer settings; restore a valid config before enabling.');
  if ((c.version === 2 || c.delivery !== undefined) && !['auto', 'suggest'].includes(c.delivery)) throw Error('Invalid Composer delivery mode.');
  c.sessions.forEach(sessionId); c.exclude.forEach(sessionId); return { ...c, version: 2, delivery: c.delivery ?? 'auto' };
}
export const targeted = (c, id) => c.enabled && !c.exclude.includes(id) && (c.mode === 'all' || c.sessions.includes(id));
export function predictionRequest(exactPrompt) {
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
    if (action === 'status') {
      const state = await read(id);
      const paused = state.revision === c.revision && (state.status === 'halted' || (c.delivery === 'auto' && state.count >= c.limit));
      return `${!targeted(c, id) ? 'OFF' : paused ? 'PAUSED' : 'ON'} for ${id}\nDelivery: ${c.delivery === 'suggest' ? 'suggest — Tab to accept, Enter to send' : 'auto — send automatically'}\nScope: ${c.mode === 'all' ? 'all loaded sessions' : c.sessions.join(', ') || 'none'}\nExcluded: ${c.exclude.join(', ') || 'none'}\nLimit: ${c.limit} automatic follow-ups per session between user messages.\nLast: ${state.status}${state.error ? ' — ' + state.error : ''}`;
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
    else if (action === 'limit' && ids.length === 1) c.limit = Number(ids[0]);
    else throw Error(HELP);
    c.revision = nonce(); validateConfig(c); await store.set('config', c);
    await register(id, cwd);
    return `${await command('status', id, cwd)}\nSettings apply to this harness only; other loaded sessions read them before submitting.`;
  }
  async function human(id) {
    const s = await read(id); await store.set(recordKey(id), { ...s, count: 0 });
  }
  async function run({ id, source, cwd, current, predict, submit, suggest, supportsSuggestions = true }) {
    if (busy || !source) return;
    busy = true;
    let state, revision;
    try {
      const c = await config(); revision = c.revision;
      if (!targeted(c, id) || (c.delivery === 'suggest' && !supportsSuggestions) || !await current()) return;
      state = await read(id);
      if (state.revision !== revision) state = { ...state, revision, count: 0, error: undefined, status: 'idle' };
      if (state.source === source || state.status === 'halted' || (c.delivery === 'auto' && state.count >= c.limit)) return;
      state = { ...state, id, source, cwd, status: 'predicting', updatedAt: Date.now() };
      // Reserve before the model call; reloads and ambiguous submissions never replay this source.
      await store.set(recordKey(id), state);
      const raw = await predict();
      if (raw === null) throw Error('Prediction model did not answer. Run composer on to retry on a future turn.');
      const text = parseSuggestion(raw);
      const latest = await config();
      if (latest.revision !== revision || !targeted(latest, id) || !await current()) state.status = 'cancelled';
      else if (text === null) state.status = 'abstained';
      else {
        state = { ...state, count: state.count + (c.delivery === 'auto' ? 1 : 0), status: 'reserved' };
        await store.set(recordKey(id), state);
        const final = await config();
        if (final.revision !== revision || !targeted(final, id) || !await current()) state.status = 'cancelled';
        else if (c.delivery === 'suggest') {
          // The adapter may retain this guard until the user presses Tab.
          const valid = async () => {
            const now = await config();
            return now.revision === revision && targeted(now, id) && now.delivery === 'suggest' && await current();
          };
          state.status = await suggest(text, valid) === false ? 'cancelled' : 'suggested';
        } else { await submit(text); state.status = 'submitted'; }
      }
      await store.set(recordKey(id), { ...state, updatedAt: Date.now() });
    } catch (e) {
      if (state) await store.set(recordKey(id), { ...state, revision, status: 'halted', error: String(e), updatedAt: Date.now() });
      throw e;
    } finally { busy = false; }
  }
  return { command, register, human, run };
}
