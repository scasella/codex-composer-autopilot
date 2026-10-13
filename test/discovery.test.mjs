import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, contracts, loadBindings } from '../src/discovery.mjs';

function fixture(templates, prefix) {
  const module = {}, snippets = [];
  for (const [role, template] of Object.entries(templates)) {
    if (role === 'persistedDraft' && templates.composerDraft) continue;
    const aliases = new Map();
    const source = template.replace(/\$[A-Za-z]\w*/g, name => {
      if (!aliases.has(name)) aliases.set(name, `${prefix}_${role}_${aliases.size}`);
      return aliases.get(name);
    });
    const alias = `${prefix}_${role}_export`;
    module[alias] = { role };
    if (role === 'composerDraft') {
      module[`${prefix}_persistedDraft_export`] = { role: 'persistedDraft' };
      snippets.push({ source: '', exported: `${aliases.get('$persisted')} as ${prefix}_persistedDraft_export` });
    }
    snippets.push({ source, exported: `${aliases.get('$binding')} as ${alias}` });
  }
  return { module, source: snippets.map(s => s.source).join(';') +
    `;export{${snippets.map(s => s.exported).join(',')}};` };
}
for (const kind of ['shared', 'initial']) {
  test(`${kind}: resolves independently renamed internals and exports`, () => {
    for (const prefix of ['buildA', '$nextBuild']) {
      const f = fixture(contracts[kind], prefix);
      const result = discover(f.source, f.module, contracts[kind]);
      assert.deepEqual(Object.keys(result), Object.keys(contracts[kind]));
      for (const [role, value] of Object.entries(result)) assert.equal(value.role, role);
    }
  });
  test(`${kind}: refuses missing, ambiguous or unexported interfaces`, () => {
    const f = fixture(contracts[kind], 'build');
    assert.throws(() => discover('', f.module, contracts[kind]), /export table/);
    assert.throws(() => discover(f.source, {}, contracts[kind]), /not exported/);
    assert.throws(() => discover(f.source.split(';export')[0] + ';' + f.source, f.module, contracts[kind]), /found 2/);
  });
}
test('changed send path or missing draft protections cannot pass discovery', () => {
  const f = fixture(contracts.initial, 'build');
  for (const field of ['sendFollowUpMessage', 'useUserMessageAdmission', 'imageAttachments', 'drafts$']) {
    assert.throws(() => discover(f.source.replaceAll(field, 'changedInterface'), f.module, contracts.initial), /interface signature/);
  }
});
test('changed busy, queue eligibility, or history semantics cannot pass discovery', () => {
  const f = fixture(contracts.shared, 'build');
  for (const field of ['unconfirmedTurnSubmissions', 'entitiesByKey', 'threadStartKind', 'retainedScopeEntries']) {
    assert.throws(() => discover(f.source.replaceAll(field, 'changedInterface'), f.module, contracts.shared), /interface signature/);
  }
});

test('discovers changed asset hashes using only same-origin loaded modules', async () => {
  for (const hash of ['oldhash', 'completely_NEW-123']) {
    const shared = fixture(contracts.shared, 'build'), initial = fixture(contracts.initial, 'build');
    shared.module.actions = { scope: { chain: new Map() }, run() {} };
    shared.module.rpc = { cumberbatch: { requestUserMessagePrediction() {} } };
    const assets = new Map([['shared', shared], ['initial', initial]].map(([kind, value]) =>
      [`app://-/assets/app-${kind}-${hash}.js`, value]));
    const env = { location: new URL('app://-/index.html'),
      performance: { getEntriesByType: () => [...assets.keys(), 'https://example.com/assets/app-shared-external.js'].map(name => ({ name })) },
      document: { querySelectorAll: () => [] },
      fetch: async url => ({ ok: true, text: async () => assets.get(url).source }) };
    const load = async url => assets.get(url).module;
    const result = await loadBindings(discover, contracts, env, load);
    assert.equal(result.send.role, 'send');
    assert.equal(result.scope, shared.module.actions.scope);
    assets.set('app://-/assets/app-shared-duplicate.js', shared);
    await assert.rejects(loadBindings(discover, contracts, env, load), /expected one loaded module/);
  }
});
