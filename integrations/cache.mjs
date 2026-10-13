// Telemetry is optional. Missing or malformed fields are not zero cache hits.
const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const cacheUsage = usage => ({ read: tokens(usage?.read), write: tokens(usage?.write) });
export function cacheStatus(value) {
  if (value === undefined) return 'not recorded yet';
  const { read, write } = cacheUsage(value);
  if (read === null && write === null) return 'unavailable (provider did not report cache usage)';
  return `${read === null ? 'hit unknown' : read > 0 ? 'hit' : 'no hit reported'}; read ${read ?? 'unknown'}, wrote ${write ?? 'unknown'} tokens`;
}

// Pi already adds Anthropic cache markers. Move its final marker from our
// synthetic prediction request onto the reusable history; preserve TTL/opt-out.
// Other wire formats and unfamiliar payloads pass through unchanged.
export function cachePiHistory(payload, model) {
  if (model?.api !== 'anthropic-messages' || !Array.isArray(payload?.messages)) return;
  const messages = payload.messages, last = messages.at(-1);
  if (!Array.isArray(last?.content)) return;
  const tail = last.content.at(-1);
  if (last?.role !== 'user' || tail?.type !== 'text' || tail.cache_control?.type !== 'ephemeral') return;
  for (let i = messages.length - 2; i >= 0; i--) {
    const content = messages[i].content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      if (!['text', 'image', 'tool_use', 'tool_result'].includes(content[j]?.type)) continue;
      const next = messages.slice(), history = content.slice(), end = last.content.slice();
      history[j] = { ...content[j], cache_control: content[j].cache_control ?? tail.cache_control };
      const { cache_control, ...uncached } = tail;
      end[end.length - 1] = uncached;
      next[i] = { ...messages[i], content: history };
      next[next.length - 1] = { ...last, content: end };
      return { ...payload, messages: next };
    }
  }
}
