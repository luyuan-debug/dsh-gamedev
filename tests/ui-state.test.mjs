import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

/**
 * Deterministic state-logic tests against the built browser module.
 * This small hook harness exercises the shipped component's event handlers and
 * native form operations. It is not a browser, React renderer or DSH acceptance.
 * Build first: npm run build; then node --test tests/ui-state.test.mjs.
 */
const bundle = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const elements = (tree) => tree && typeof tree === 'object'
  ? [tree, ...(tree.children ?? []).flatMap(elements)] : [];

function setup(overrides = {}) {
  const hooks = [];
  const disposers = [];
  const registrations = [];
  const served = [];
  let factory;
  let component;
  let props;
  let cursor = 0;
  let pendingEffects = [];
  let accepted = true;
  let thrown = false;
  let snapshot = {
    status: 'ready', revision: 1, writable: true,
    value: {
      enabled: false, projectRoot: '/sandbox/game', godotExecutable: '/sandbox/Godot',
      bridgeMode: 'stdio', bridgeExecutable: '/sandbox/bridge',
      bridgeUrl: 'ws://127.0.0.1:19080', bridgeEndpoint: '',
      bridgeSecretRef: 'DSH_GODOT_BRIDGE_TOKEN', httpSecretRef: '',
      allowedOptionalTools: [], gdtoolkitExecutable: '', imagemagickExecutable: '',
      ffmpegExecutable: '', testFrameworkPreference: 'existing', health: '',
      ...overrides,
    },
  };
  const calls = [];
  const React = {
    createElement: (type, properties, ...children) => ({ type, props: properties ?? {}, children: children.flat(Infinity) }),
    Fragment: 'Fragment',
    useCallback: (callback) => callback,
    useRef(initial) { const key = cursor++; return hooks[key] ??= { current: initial }; },
    useState(initial) {
      const key = cursor++;
      if (!(key in hooks)) hooks[key] = typeof initial === 'function' ? initial() : initial;
      return [hooks[key], (next) => { hooks[key] = typeof next === 'function' ? next(hooks[key]) : next; }];
    },
    useEffect(callback, dependencies) {
      const key = cursor++;
      if (!hooks[key] || dependencies.some((value, index) => !Object.is(value, hooks[key][index]))) pendingEffects.push(callback);
      hooks[key] = dependencies;
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { factory = definition.factory; assert.equal(definition.id, 'dsh-gamedev'); } } },
    URL, requestAnimationFrame: (callback) => callback(),
    document: { getElementById: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  };
  vm.runInNewContext(bundle, sandbox);
  const plugin = factory((id) => {
    if (id === 'react') return React;
    assert.equal(id, '@deepseek-ai/dsh-client-ui-primitives');
    return { Button: 'NativeButton', Switch: 'NativeSwitch' };
  });
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async mutate(operations, expectedRevision) {
      calls.push({ operations: clone(operations), expectedRevision });
      if (thrown) throw new Error('Intentionally failed transport');
      if (!accepted || expectedRevision !== snapshot.revision) return false;
      const value = { ...snapshot.value };
      for (const operation of operations) {
        assert.equal(operation.op, 'set');
        assert.equal(operation.path.length, 1);
        value[operation.path[0]] = operation.value;
      }
      snapshot = { ...snapshot, value, revision: snapshot.revision + 1 };
      return true;
    },
  };
  const context = {
    locale: { bind: () => (key) => key, register: (_namespace, dictionaries) => {
      assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
      return () => {};
    } },
    effect(callback) { const disposer = callback(); if (disposer) disposers.push(disposer); },
    configForms: {
      whileServed(namespaces, register) { served.push(...namespaces); return register(); },
      get(namespace) { assert.equal(namespace, 'gamedev-settings'); return form; },
    },
    slots: {
      inject(name, register) { assert.equal(name, 'settings.section'); return register(); },
      register(options, Component) {
        registrations.push(options);
        component = Component;
        props = { t: (key) => key, close() {}, ...options.inject() };
        return () => {};
      },
    },
  };
  plugin.apply(context);
  function render() {
    cursor = 0;
    pendingEffects = [];
    const tree = component(props);
    for (const effect of pendingEffects) effect();
    return tree;
  }
  const byId = (tree, id) => elements(tree).find((element) => element.props.id === id);
  const action = (tree, label) => elements(tree).find((element) => element.type === 'NativeButton' && element.children.includes(label));
  const toggle = (tree, label) => elements(tree).find((element) => element.type === 'NativeSwitch' && element.props.label === label);
  const edit = (tree, id, value) => byId(tree, id).props.onChange({ target: { value } });
  const submit = async (tree) => tree.props.onSubmit({ preventDefault() {} });
  return {
    render, byId, action, toggle, edit, submit, calls, served, registrations, plugin,
    get snapshot() { return snapshot; },
    setResponse(value) { accepted = value; },
    failTransport() { thrown = true; },
    external(value) { snapshot = { ...snapshot, value: { ...snapshot.value, ...value }, revision: snapshot.revision + 1 }; },
    setWritable(value) { snapshot = { ...snapshot, writable: value }; },
    dispose() { for (const disposer of disposers.reverse()) disposer(); },
  };
}

test('one native section follows the owning namespace and provides both locale dictionaries', () => {
  const ui = setup();
  assert.deepEqual(ui.served, ['gamedev-settings']);
  assert.equal(ui.registrations.length, 1);
  assert.equal(ui.registrations[0].name, 'settings.section');
  assert.equal(ui.registrations[0].id, 'godot-2d');
  assert.deepEqual(clone(ui.plugin.inject), ['slots', 'locale', 'configForms']);
  ui.dispose();
});

test('typing stays staged and one save submits only changed fields, never health', async () => {
  const ui = setup({ health: JSON.stringify({ status: 'DISCONNECTED' }) });
  let tree = ui.render();
  ui.edit(tree, 'gamedev-projectRoot', '/sandbox/next');
  assert.equal(ui.calls.length, 0);
  tree = ui.render();
  await ui.submit(tree);
  assert.deepEqual(ui.calls, [{ operations: [{ op: 'set', path: ['projectRoot'], value: '/sandbox/next' }], expectedRevision: 1 }]);
  assert.equal(ui.snapshot.value.health, JSON.stringify({ status: 'DISCONNECTED' }));
});

test('Host rejection and transport failure both preserve the draft', async () => {
  for (const transportFailure of [false, true]) {
    const ui = setup();
    let tree = ui.render();
    ui.edit(tree, 'gamedev-projectRoot', '/sandbox/draft');
    if (transportFailure) ui.failTransport(); else ui.setResponse(false);
    tree = ui.render();
    await ui.submit(tree);
    tree = ui.render();
    assert.equal(ui.byId(tree, 'gamedev-projectRoot').props.value, '/sandbox/draft');
    assert(elements(tree).some((element) => element.props.role === 'alert' && element.children.some((child) => child?.children?.includes('saveFailed'))));
  }
});

test('conflict requires explicit merge and retains local edits while adopting untouched Host fields', async () => {
  const ui = setup();
  let tree = ui.render();
  ui.edit(tree, 'gamedev-projectRoot', '/sandbox/draft');
  ui.external({ godotExecutable: '/sandbox/updated-Godot' });
  tree = ui.render();
  assert.equal(ui.action(tree, 'save').props.disabled, true);
  assert.equal(ui.byId(tree, 'gamedev-projectRoot').props.value, '/sandbox/draft');
  ui.action(tree, 'merge').props.onClick();
  tree = ui.render();
  assert.equal(ui.byId(tree, 'gamedev-projectRoot').props.value, '/sandbox/draft');
  assert.equal(ui.byId(tree, 'gamedev-godotExecutable').props.value, '/sandbox/updated-Godot');
  await ui.submit(tree);
  assert.equal(ui.calls.at(-1).expectedRevision, 2);
  assert.equal(ui.snapshot.value.godotExecutable, '/sandbox/updated-Godot');
});

test('disabling an accepted bridge immediately revokes despite an invalid unrelated draft', async () => {
  const ui = setup({ enabled: true });
  let tree = ui.render();
  ui.edit(tree, 'gamedev-projectRoot', 'relative invalid path');
  tree = ui.render();
  await ui.toggle(tree, 'enabled').props.onChange(false);
  tree = ui.render();
  assert.deepEqual(ui.calls, [{ operations: [{ op: 'set', path: ['enabled'], value: false }], expectedRevision: 1 }]);
  assert.equal(ui.snapshot.value.enabled, false);
  assert.equal(ui.byId(tree, 'gamedev-projectRoot').props.value, 'relative invalid path');
});

test('failed disable leaves accepted enablement visible and reports the failure', async () => {
  const ui = setup({ enabled: true });
  let tree = ui.render();
  ui.setResponse(false);
  await ui.toggle(tree, 'enabled').props.onChange(false);
  tree = ui.render();
  assert.equal(ui.snapshot.value.enabled, true);
  assert.equal(ui.toggle(tree, 'enabled').props.checked, true);
  assert(elements(tree).some((element) => element.children.includes('disableFailed')));
});

test('stdio validation rejects non-loopback addresses and literal secrets before sending a mutation', async () => {
  const ui = setup();
  let tree = ui.render();
  ui.edit(tree, 'gamedev-bridgeUrl', 'ws://remote.example:19080');
  ui.edit(tree, 'gamedev-bridgeSecretRef', 'secret/value');
  tree = ui.render();
  await ui.submit(tree);
  tree = ui.render();
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.byId(tree, 'gamedev-bridgeUrl').props['aria-invalid'], true);
  assert.equal(ui.byId(tree, 'gamedev-bridgeSecretRef').props['aria-invalid'], true);
});

test('HTTP is an unavailable candidate with read-only references and cannot be enabled', async () => {
  const ui = setup({ bridgeMode: 'existing-loopback-http', bridgeEndpoint: 'http://127.0.0.1:19081/mcp' });
  let tree = ui.render();
  const httpOption = elements(tree).find((element) => element.type === 'option' && element.props.value === 'existing-loopback-http');
  assert.equal(httpOption.props.disabled, true);
  assert.equal(ui.byId(tree, 'gamedev-bridgeEndpoint').props.readOnly, true);
  assert.equal(ui.byId(tree, 'gamedev-httpSecretRef').props.readOnly, true);
  assert.equal(ui.toggle(tree, 'enabled').props.disabled, true);
  await ui.toggle(tree, 'enabled').props.onChange(true);
  tree = ui.render();
  assert.equal(ui.toggle(tree, 'enabled').props.checked, false);
  assert.equal(ui.calls.length, 0);
  ui.edit(tree, 'gamedev-bridgeMode', 'stdio');
  tree = ui.render();
  assert.equal(ui.toggle(tree, 'enabled').props.disabled, false);
});

test('enabling stdio requires a token reference but keeps the mode selectable for incomplete configuration', async () => {
  const ui = setup({ bridgeExecutable: '', bridgeSecretRef: '' });
  let tree = ui.render();
  await ui.toggle(tree, 'enabled').props.onChange(true);
  tree = ui.render();
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.byId(tree, 'gamedev-bridgeMode').props.disabled, false);
  await ui.submit(tree);
  tree = ui.render();
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.byId(tree, 'gamedev-bridgeSecretRef').props['aria-invalid'], true);
});

test('flat Host health JSON exposes real diagnostic fields and optional-tool status without new transport', () => {
  const ui = setup({ health: JSON.stringify({
    status: 'MCP_READY', reason: 'Last editor check observed online; no continuous monitoring.', version: '0.2.0',
    godotVersion: '4.7.2.stable.mono', bridgeVersion: '2026.10.20.1',
    projectRoot: '/sandbox/game', appliedProject: '/sandbox/bound-game', ownerSession: 'synthetic-owner', appliedGeneration: 'abc123', savedGeneration: 'new-saved-generation', lastHealthAt: '2026-10-23T15:00:00Z', lastEditorConnected: true,
    optionalTools: { imagemagick: { status: 'READY', allowed: true, version: 'ImageMagick 7.1.2-25', reason: '' } },
  }) });
  const tree = ui.render();
  const text = elements(tree).flatMap((element) => element.children.filter((child) => typeof child === 'string')).join('\n');
  for (const value of ['MCP_READY', 'Last editor check observed online; no continuous monitoring.', '/sandbox/bound-game', 'synthetic-owner', 'new-saved-generation', '2026-10-23T15:00:00Z', '4.7.2.stable.mono', '2026.10.20.1', 'abc123', 'READY', 'ImageMagick 7.1.2-25']) assert(text.includes(value), value);
  assert.equal(ui.calls.length, 0);
});

test('read-only Host configuration disables edits and dispatches no mutation', async () => {
  const ui = setup({ enabled: true });
  ui.setWritable(false);
  const tree = ui.render();
  assert.equal(ui.byId(tree, 'gamedev-projectRoot').props.disabled, true);
  assert.equal(ui.toggle(tree, 'enabled').props.disabled, true);
  await ui.toggle(tree, 'enabled').props.onChange(false);
  await ui.submit(tree);
  assert.equal(ui.calls.length, 0);
});
