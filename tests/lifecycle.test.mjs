import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeLease } from '../dist/lifecycle.js';

// These are state-machine tests against the real exported class. A controlled
// NativeMount substitutes for nativeFork; this file does not launch DSH or MCP.
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush() { for (let n = 0; n < 5; n++) await tick(); }
async function within(promise, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(description)), 500); }),
    ]);
  } finally { clearTimeout(timer); }
}
function agent(id = 'session-A', target = 'A') { return { id, target, alive: true }; }
function harness(options = {}) {
  const h = { enabled: true, settings: { target: 'A' }, mounts: [], states: [] };
  h.manager = new NativeLease({
    eligible: candidate => candidate.alive,
    enabled: () => h.enabled,
    settings: () => h.settings,
    compatible: (candidate, settings) => candidate.target === settings.target,
    priorStop: options.priorStop,
    state: (phase, detail, lease) => h.states.push({ phase, detail, lease }),
    start: lease => {
      const index = h.mounts.length;
      const gates = options.gates?.(index, lease) ?? {};
      const record = { lease, disposals: 0, disposed: false };
      record.mount = {
        ready: gates.ready ?? Promise.resolve(),
        dispose() {
          record.disposals++;
          return Promise.resolve(gates.dispose).then(() => { record.disposed = true; });
        },
      };
      h.mounts.push(record);
      options.onStart?.(h, record, index);
      return record.mount;
    },
  });
  return h;
}

test('the exact same Agent can concurrently request a lease only once', async () => {
  const ready = deferred();
  const h = harness({ gates: () => ({ ready: ready.promise }) });
  const a = agent();
  const first = h.manager.request(a);
  await flush();
  const duplicate = Array.from({ length: 12 }, () => h.manager.request(a));
  await flush();
  assert.equal(h.mounts.length, 1);
  assert.equal(h.manager.owns(a), false);
  ready.resolve();
  await Promise.all([first, ...duplicate]);
  assert.equal(h.mounts.length, 1);
  assert.equal(h.manager.owns(a), true);
  assert.equal(h.states.filter(item => item.phase === 'MCP_READY').length, 1);
  await h.manager.request(a);
  assert.equal(h.mounts.length, 1);
  await h.manager.shutdown();
});

test('a second eligible active Agent cannot steal an existing lease', async () => {
  const h = harness();
  const a = agent(), b = agent('session-B');
  await h.manager.request(a);
  await h.manager.request(b);
  assert.equal(h.mounts.length, 1);
  assert.equal(h.manager.preferred, a);
  assert.equal(h.manager.owns(a), true);
  assert.equal(h.manager.owns(b), false);
  await h.manager.released(b);
  assert.equal(h.mounts[0].disposals, 0);
  assert.equal(h.manager.owns(a), true);
  await h.manager.shutdown();
});

test('Agent identity, not a reused session id, owns and releases the lease', async () => {
  const h = harness();
  const old = agent('reused-id'), replacement = agent('reused-id');
  await h.manager.request(old);
  assert.equal(h.manager.owns(replacement), false);
  await h.manager.released(replacement);
  assert.equal(h.manager.owns(old), true);
  old.alive = false;
  await h.manager.request(replacement);
  assert.equal(h.mounts.length, 2);
  assert.equal(h.mounts[0].disposals, 1);
  assert.equal(h.manager.owns(replacement), true);
  await h.manager.released(old);
  assert.equal(h.mounts[1].disposals, 0);
  assert.equal(h.manager.owns(replacement), true);
  await h.manager.shutdown();
});

test('disabling synchronously revokes authority and repeated notifications dispose once', async () => {
  const stop = deferred();
  const h = harness({ gates: () => ({ dispose: stop.promise }) });
  const a = agent();
  await h.manager.request(a);
  h.enabled = false;
  const first = h.manager.changed();
  assert.equal(h.manager.owns(a), false, 'authority must end before cleanup finishes');
  const second = h.manager.changed();
  await flush();
  assert.equal(h.mounts[0].disposals, 1);
  assert.equal(h.mounts[0].disposed, false);
  stop.resolve();
  await Promise.all([first, second]);
  assert.equal(h.manager.lease, undefined);
  assert.equal(h.states.at(-1).phase, 'DISABLED');
  await h.manager.shutdown();
  assert.equal(h.mounts[0].disposals, 1);
});

test('enable and requests during deferred disposal never overlap native mounts', async () => {
  const stop = deferred();
  const h = harness({ gates: index => index === 0 ? { dispose: stop.promise } : {} });
  const a = agent();
  await h.manager.request(a);
  h.enabled = false;
  const disabled = h.manager.changed();
  h.enabled = true;
  const enabled = h.manager.changed();
  const requested = h.manager.request(a);
  await flush();
  assert.equal(h.mounts.length, 1, 'old native disposal is still pending');
  assert.equal(h.manager.owns(a), false);
  stop.resolve();
  await Promise.all([disabled, enabled, requested]);
  assert.equal(h.mounts.length, 2);
  assert.equal(h.mounts[0].disposed, true);
  assert.equal(h.mounts[0].disposals, 1);
  assert.equal(h.manager.owns(a), true);
  await h.manager.shutdown();
});

test('revoking a pending startup disposes immediately and settles without its ready promise', async () => {
  const ready = deferred();
  const h = harness({ gates: () => ({ ready: ready.promise }) });
  const a = agent();
  const requested = h.manager.request(a);
  await flush();
  assert.equal(h.mounts.length, 1);
  assert.equal(h.manager.owns(a), false);
  h.enabled = false;
  const revoked = h.manager.changed();
  await flush();
  assert.equal(h.mounts[0].disposals, 1);
  try {
    await within(Promise.all([requested, revoked]), 'revocation waited for an unresolved native ready promise');
    assert.equal(h.manager.lease, undefined);
    assert.equal(h.states.at(-1).phase, 'DISABLED');
  } finally {
    ready.resolve();
    await Promise.all([requested, revoked]);
    await h.manager.shutdown();
  }
});

test('a stale startup ready completion cannot publish MCP_READY after revocation', async () => {
  const ready = deferred();
  const h = harness({ gates: index => index === 0 ? { ready: ready.promise } : {} });
  const a = agent();
  const first = h.manager.request(a);
  await flush();
  h.enabled = false;
  const revoked = h.manager.changed();
  try {
    await within(Promise.all([first, revoked]), 'stale pending startup prevented a replacement');
    assert.equal(h.states.filter(item => item.phase === 'MCP_READY').length, 0);
    assert.equal(h.manager.owns(a), false);
    h.enabled = true;
    await h.manager.request(a);
    assert.equal(h.mounts.length, 2);
    const replacement = h.manager.lease;
    ready.resolve();
    await flush();
    assert.equal(h.manager.lease, replacement, 'old ready must not replace the current lease');
    assert.equal(h.mounts[0].disposals, 1);
    assert.equal(h.states.filter(item => item.phase === 'MCP_READY').length, 1);
    assert.equal(h.states.find(item => item.phase === 'MCP_READY').lease, h.mounts[1].lease);
    assert.equal(h.manager.owns(a), true);
  } finally {
    ready.resolve();
    await Promise.all([first, revoked]);
    await h.manager.shutdown();
  }
});

test('a synchronous revoke inside start still disposes the returned mount exactly once', async () => {
  const h = harness({ onStart: (state, _record, index) => {
    if (index === 0) { state.enabled = false; void state.manager.changed(); }
  } });
  const a = agent();
  await h.manager.request(a);
  assert.equal(h.mounts[0].disposals, 1, 'start returned a mount after revoke began');
  assert.equal(h.mounts[0].disposed, true);
  assert.equal(h.manager.owns(a), false);
  assert.equal(h.states.some(item => item.phase === 'MCP_READY'), false);
  await h.manager.shutdown();
  assert.equal(h.mounts[0].disposals, 1);
});

test('shutdown is idempotent, revokes immediately and permanently rejects new requests', async () => {
  const stop = deferred();
  const h = harness({ gates: () => ({ dispose: stop.promise }) });
  const a = agent();
  await h.manager.request(a);
  const one = h.manager.shutdown();
  const two = h.manager.shutdown();
  assert.equal(one, two);
  assert.equal(h.manager.owns(a), false);
  await h.manager.request(agent('late'));
  await flush();
  assert.equal(h.mounts[0].disposals, 1);
  assert.equal(h.mounts.length, 1);
  stop.resolve();
  await one;
  await h.manager.changed();
  await h.manager.request(a);
  assert.equal(h.mounts.length, 1);
  assert.equal(h.states.at(-1).phase, 'UNLOADED');
});

test('shutdown can retire a startup whose ready promise never settles', async () => {
  const ready = deferred();
  const h = harness({ gates: () => ({ ready: ready.promise }) });
  const requested = h.manager.request(agent());
  await flush();
  const shutdown = h.manager.shutdown();
  try {
    await within(shutdown, 'shutdown waited for an unresolved native ready promise');
    assert.equal(h.mounts[0].disposals, 1);
    assert.equal(h.manager.lease, undefined);
    assert.equal(h.states.at(-1).phase, 'UNLOADED');
  } finally {
    ready.resolve();
    await Promise.all([requested, shutdown]);
  }
});

test('target changes revoke old ownership without rebinding the existing Agent', async () => {
  const h = harness();
  const a = agent();
  await h.manager.request(a);
  h.settings = { target: 'B' };
  const changed = h.manager.changed();
  assert.equal(h.manager.owns(a), false);
  await changed;
  await h.manager.request(a);
  assert.equal(h.mounts.length, 1);
  assert.equal(h.mounts[0].disposals, 1);
  assert.equal(h.states.at(-1).phase, 'NEW_SESSION_REQUIRED');
  const b = agent('new-target-session', 'B');
  await h.manager.request(b);
  assert.equal(h.mounts.length, 2);
  assert.equal(h.mounts[1].lease.agent, b);
  assert.deepEqual(h.mounts[1].lease.settings, { target: 'B' });
  assert.equal(h.manager.owns(a), false);
  assert.equal(h.manager.owns(b), true);
  await h.manager.shutdown();
});

test('a prior definition cleanup barrier prevents starting a new native mount', async () => {
  const priorStop = deferred();
  const h = harness({ priorStop: priorStop.promise });
  const a = agent();
  const requested = h.manager.request(a);
  await flush();
  assert.equal(h.mounts.length, 0);
  assert.equal(h.manager.owns(a), false);
  priorStop.resolve();
  await requested;
  assert.equal(h.mounts.length, 1);
  assert.equal(h.manager.owns(a), true);
  await h.manager.shutdown();
});

test('revocation during the prior-stop barrier prevents a stale launch', async () => {
  const priorStop = deferred();
  const h = harness({ priorStop: priorStop.promise });
  const requested = h.manager.request(agent());
  await flush();
  h.enabled = false;
  const revoked = h.manager.changed();
  priorStop.resolve();
  await Promise.all([requested, revoked]);
  assert.equal(h.mounts.length, 0);
  assert.equal(h.states.at(-1).phase, 'DISABLED');
  await h.manager.shutdown();
});

test('a target change during the prior-stop barrier cannot start the stale target', async () => {
  const priorStop = deferred();
  const h = harness({ priorStop: priorStop.promise });
  const requested = h.manager.request(agent());
  await flush();
  h.settings = { target: 'B' };
  const changed = h.manager.changed();
  priorStop.resolve();
  await Promise.all([requested, changed]);
  assert.equal(h.mounts.length, 0, 'no native mount may start with the old target snapshot');
  assert.equal(h.states.at(-1).phase, 'NEW_SESSION_REQUIRED');
  await h.manager.shutdown();
});

test('an Agent replaced while awaiting prior cleanup is never started', async () => {
  const priorStop = deferred();
  const h = harness({ priorStop: priorStop.promise });
  const old = agent('old'), replacement = agent('new');
  const requested = h.manager.request(old);
  await flush();
  old.alive = false;
  const replaced = h.manager.request(replacement);
  priorStop.resolve();
  await Promise.all([requested, replaced]);
  assert.deepEqual(h.mounts.map(record => record.lease.agent), [replacement]);
  assert.equal(h.manager.owns(old), false);
  assert.equal(h.manager.owns(replacement), true);
  await h.manager.shutdown();
});

test('a rejected native startup releases its mount and permits a later explicit retry', async () => {
  const ready = deferred();
  const h = harness({ gates: index => index === 0 ? { ready: ready.promise } : {} });
  const a = agent();
  const requested = h.manager.request(a);
  await flush();
  ready.reject(new Error('controlled native startup failure'));
  await requested;
  assert.equal(h.mounts.length, 1);
  assert.equal(h.mounts[0].disposals, 1);
  assert.equal(h.manager.lease, undefined);
  assert.equal(h.states.at(-1).phase, 'UNAVAILABLE');
  assert.match(h.states.at(-1).detail, /controlled native startup failure/);
  await h.manager.request(a);
  assert.equal(h.mounts.length, 2);
  assert.equal(h.manager.owns(a), true);
  await h.manager.shutdown();
});
