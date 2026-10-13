// Match complete interface snippets, allowing only local identifier renaming.
// $names bind once and must match on subsequent occurrences. No evaluated source.
export function discover(source, module, templates) {
  const fail = detail => { throw Error(`Renderer interface incompatible: ${detail}`); };
  const exports = [...source.matchAll(/export\s*\{([^}]+)\}\s*;/g)];
  if (exports.length !== 1) fail('expected one module export table');
  const names = new Map(exports[0][1].split(',').map(s => {
    const pair = s.trim().split(/\s+as\s+/); return [pair[0], pair[1] ?? pair[0]];
  }));
  const result = {};
  for (const [role, template] of Object.entries(templates)) {
    const seen = new Set();
    const pattern = template.split(/(\$[A-Za-z]\w*)/).map(part => {
      if (!/^\$[A-Za-z]\w*$/.test(part)) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const name = part.slice(1);
      if (seen.has(name)) return `\\k<${name}>`;
      seen.add(name); return `(?<${name}>[A-Za-z_$][\\w$]*)`;
    }).join('');
    const matches = [...source.matchAll(new RegExp(pattern, 'g'))];
    if (matches.length !== 1) fail(`${role}: expected one interface signature, found ${matches.length}`);
    const name = names.get(matches[0].groups.binding);
    if (!name || module[name] == null) fail(`${role}: binding is not exported`);
    result[role] = module[name];
  }
  return result;
}

export const contracts = {
  shared: {
    managers: '$binding=$atom($scope,({get:$get})=>$get($hosts).flatMap($host=>{let $manager=$get($managerAtom,$host);return $manager==null?[]:[$manager]}))',
    latest: 'function $unhydrated($c){return $c.resumeState!==`needs_resume`||$c.turnHistory?.kind===`canonical`?null:$c.turns}function $binding($c){if($c.turnHistory?.kind===`canonical`){let{history:$history}=$c.turnHistory,$island=$last($history);if($island!=null){let $key=$island.entries.at(-1)?.value;return $key==null?null:$history.entitiesByKey[$key]??null}}return $turns($c).at(-1)??null}',
    busy: 'function $binding($c){if($c.unconfirmedTurnSubmissions?.some($turn=>$turn.terminal!==!0))return!0;let{resumeState:$state,threadRuntimeStatus:$runtime}=$c,$turns=$read($c);return $state===`needs_resume`?$runtime?.type===`active`:$turns.length===0?$state===`resuming`:$latest({turns:$turns})?.status===`inProgress`}',
    retained: 'function $binding($scope,$type,$key){if($type.parent==null)return null;let $node=$lookup($scope.chain,$type.parent).retainedScopeEntries.get($type)?.get($key)?.node;if($node==null)return null;let $chain=new Map($scope.chain);return $chain.set($type.id,$node),$wrap($type,$chain,$node)}',
    excluded: '$binding=$atom($scope,($id,{get:$get})=>{if($id==null)return!1;if($get($mode,$id)!==`off`)return!0;let $summary=$get($conversation,{hostId:$get($host,$id),threadId:$id})?.summary;return $check($summary?.threadStartKind,$summary?.threadSource)},{owner:$key=>$key})'
  },
  initial: {
    persistedDraft: 'function $binding($scope,$key){let $draft=$scope.get($store.drafts$)[$key];return!$expired($draft,$scope.get($retention,$key))&&$hasText($deserialize($draft))}',
    composerDraft: 'function $binding($scope){return $hasText($scope.get($draft))||$attachments($scope)}function $persisted($scope,$key){let $value=$scope.get($store.drafts$)[$key];return!$expired($value,$scope.get($retention,$key))&&$hasText($deserialize($value))}function $attachments($scope,{ignoreModelContext:$ignore=!1}={}){let $value=$scope.get($atom);return $value.pullRequestMergeConflict!=null||[$value.imageAttachments,$value.imageCommentDrafts,$value.appshotContexts,$value.fileAttachments,$value.pastedTextAttachments,$value.uploadedFileAttachments,$value.addedFiles,$ignore?$value.mcpAppModelContextAttachments.filter(({kind:$kind})=>$kind!==`context`):$value.mcpAppModelContextAttachments,$value.selectedTextAttachments,$value.responseTextAnnotations,$scope.get($a),$scope.get($b),$scope.get($c),$scope.get($d),$scope.get($e,$keyOf($scope.value))].some($items=>$items.length>0)}',
    send: 'async function $binding($scope,$host,$id,$options){if($options.prompt.trim().length===0)throw Error(`Cannot send an empty follow-up message.`);let $tracker=$getTracker($scope),$attempted=!1,$turn=null;try{$tracker.trackMessageEvent($host,$events.CODEX_REMOTE_SSH_MESSAGE_RESULT_ATTEMPTED,`steer`,{threadId:$id}),$attempted=!0;let $manager=$getManager($scope,$host),$conversation=$scope.get($atom,$host)?.getConversation($id)??null;$turn=await $manager.sendFollowUpMessage($id,{...$options,useUserMessageAdmission:$admission($scope,$host),writingBlockContextPrepared:$conversation!=null,additionalContext:$context($id,$conversation,$options.additionalContext)}),$tracker.trackMessageEvent($host,$events.CODEX_REMOTE_SSH_MESSAGE_RESULT_SUCCEEDED,`steer`,{threadId:$id,turnId:$turn})}catch($error){throw $attempted&&$tracker.trackMessageEvent($host,$events.CODEX_REMOTE_SSH_MESSAGE_RESULT_FAILED,`steer`,{threadId:$id,turnId:$turn}),$error}}'
  }
};

export async function loadBindings(discover, contracts, env = globalThis, load = url => import(url)) {
  const fail = detail => { throw Error(`Renderer interface incompatible: ${detail}`); };
  const urls = [...new Set([...env.performance.getEntriesByType('resource').map(x => x.name),
    ...[...env.document.querySelectorAll('script[src],link[rel="modulepreload"]')].map(x => x.src || x.href)])];
  const modules = {};
  for (const kind of ['shared', 'initial']) {
    const matches = urls.filter(url => {
      const u = new URL(url, env.location.href);
      return u.protocol === env.location.protocol && u.host === env.location.host &&
        new RegExp(`^/assets/app-${kind}-[a-zA-Z0-9_-]+\\.js$`).test(u.pathname);
    });
    if (matches.length !== 1) fail(`${kind}: expected one loaded module, found ${matches.length}`);
    const response = await env.fetch(matches[0]);
    if (!response.ok) fail(`${kind}: cannot read loaded module`);
    const source = await response.text();
    if (source.length > 30000000) fail(`${kind}: unexpected module size`);
    const module = await load(matches[0]);
    modules[kind] = { module, bindings: discover(source, module, contracts[kind]) };
  }
  function unique(role, predicate) {
    const matches = [...new Set(Object.values(modules.shared.module).filter(predicate))];
    if (matches.length !== 1) fail(`${role}: expected one object, found ${matches.length}`);
    return matches[0];
  }
  const actions = unique('app scope', x => x && typeof x === 'object' && x.scope?.chain instanceof Map && typeof x.run === 'function');
  const rpc = unique('prediction service', x => x && typeof x === 'object' && typeof x.cumberbatch?.requestUserMessagePrediction === 'function');
  return { ...modules.shared.bindings, ...modules.initial.bindings, scope: actions.scope, service: rpc.cumberbatch };
}
