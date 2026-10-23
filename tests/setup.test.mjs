import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import net from 'node:net';
import { parseArgs, scrub, streamScrubber, isolatedEnv, run, absoluteExecutable, newWorkspace, readOwner, tarMembers, verifyPackage, assertFree, verifyEditorPaths, verifyRuntimeReady, probeRuntime, probeTools, profilePatch, doctor, prepare, uninstall, planOverrideRemoval, downloadArtifact } from '../scripts/setup.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gamedev-setup-tests-')));
// Full AST coverage requires an explicitly selected existing Python with the
// release-ledger PyYAML. Tests never discover, install or change a global Python.
const parserPython = process.env.DSH_GAMEDEV_SETUP_TEST_PYTHON;
if (parserPython && !path.isAbsolute(parserPython)) throw new Error('DSH_GAMEDEV_SETUP_TEST_PYTHON must be an absolute existing Python path.');
const parserTests = { skip: !parserPython };
test.after(async () => fs.rm(temp, { recursive: true, force: true }));
let sequence = 0;
const fresh = async () => { const dir = path.join(temp, String(++sequence)); await fs.mkdir(dir); return dir; };
const tar = members => {
  const blocks = [];
  for (const [name, value, type = '0'] of members) {
    const data = Buffer.from(value); const h = Buffer.alloc(512);
    h.write(name, 0, 100); h.write('0000644\0', 100); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(type, 156); h.write('ustar\0', 257); h.fill(32, 148, 156);
    const checksum = [...h].reduce((a, b) => a + b, 0); h.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
};
const basicFiles = extras => [
  ['package/package.json', JSON.stringify({ name: 'dsh-gamedev', version: '0.2.0', engines: { dsh: '0.2.1-rc.2' }, ...extras })],
  ['package/bridge/guarded_main.py', 'pass\n'], ['package/dist/index.js', 'export{};\n'],
];
async function owned(state = 'READY') {
  const w = await fresh();
  for (const d of ['dsh-home', 'agents-home', 'deps', 'state', 'logs', 'project', 'cache', 'config', 'pnpm-state', 'pnpm-home']) await fs.mkdir(path.join(w, d));
  const profile = path.join(w, 'dsh-home/profiles/gamedev-isolated'); await fs.mkdir(profile, { recursive: true });
  if (parserPython) await fs.symlink(path.dirname(path.dirname(parserPython)), path.join(w, 'deps/bridge-venv'), 'dir');
  const marker = { schemaVersion: 1, product: 'dsh-gamedev-setup', id: randomUUID(), workspace: w, state, tools: { paths: { dsh: '/fake/dsh' } }, webPort: 0, bridgePort: 0, retainedOnUninstall: ['project', 'saves', 'deps', 'dsh-home'], runtimeUserData: 'DSH-GameDev/test', godotCopy: path.join(w, 'deps/Godot.app/Contents/MacOS/Godot') };
  const patch = profilePatch(marker); marker.setupPatchSHA256 = hash(patch);
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'), patch);
  await fs.writeFile(path.join(w, '.dsh-gamedev-owner.json'), JSON.stringify(marker));
  return { w, profile, marker, patch };
}

test('argument parsing accepts explicit operations and rejects ambiguity', () => {
  assert.equal(parseArgs([]).command, 'help'); assert.equal(parseArgs(['--help']).command, 'help');
  assert.deepEqual(parseArgs(['prepare', '--workspace', '/tmp/a path', '--offline']), { command: 'prepare', options: { workspace: '/tmp/a path', offline: true } });
  assert.equal(parseArgs(['doctor', '--dotnet', '/explicit/dotnet']).options.dotnet, '/explicit/dotnet');
  for (const args of [['doctor', '--workspace'], ['doctor', '--unknown'], ['launch', '--offline', '--offline']]) assert.throws(() => parseArgs(args));
});
test('redaction removes bridge tokens and authenticated URLs', () => {
  const text = scrub('bridge=secret123 http://localhost/?token=private&ok=1', ['secret123']);
  assert(!text.includes('secret123')); assert(!text.includes('private')); assert(text.includes('&ok=1'));
});
test('stream redaction preserves secrets split across stdout chunks', () => {
  const out = []; const redactor = streamScrubber(x => out.push(x), ['secret123']);
  redactor.write(Buffer.from('prefix secr')); redactor.write(Buffer.from('et123 /?tok')); redactor.write(Buffer.from('en=private\nlast secr')); redactor.write(Buffer.from('et123')); redactor.end();
  assert(!out.join('').includes('secret123')); assert(!out.join('').includes('private')); assert.match(out.join(''), /last \[REDACTED\]/);
});
test('oversized unterminated output is omitted rather than leaking its tail', () => {
  const out = []; const redactor = streamScrubber(x => out.push(x), ['secret123']); redactor.write(Buffer.from('x'.repeat(70000))); redactor.write(Buffer.from('secret123\n')); redactor.end();
  assert.deepEqual(out, ['[Oversized output line omitted]\n']);
});
test('isolated environment retains HOME and strips ambient accounts and code injection', () => {
  process.env.DSH_SETUP_TEST_KEY = 'neverinherit'; process.env.NODE_OPTIONS = '--bad-test-value';
  const env = isolatedEnv('/owned', '/Applications/DSH.app/Contents/Resources/runtime/cli/bin/dsh');
  assert.equal(env.HOME, process.env.HOME); assert.equal(env.DSH_SETUP_TEST_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.DSH_HOME, '/owned/dsh-home'); assert.equal(env.PIP_CONFIG_FILE, '/dev/null'); assert.equal(env.PNPM_HOME, '/owned/pnpm-home');
  delete process.env.DSH_SETUP_TEST_KEY; delete process.env.NODE_OPTIONS;
});
test('isolated runtime environment uses only the explicitly selected .NET root and invocation directory', () => {
  const names = ['DOTNET_ROOT', 'DOTNET_ROOT_ARM64', 'DOTNET_HOST_PATH', 'DOTNET_CLI_HOME'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = '/ambient-never-inherit';
    const plain = isolatedEnv('/owned', '/selected/runtime/cli/bin/dsh');
    assert.equal(plain.DOTNET_ROOT, undefined);
    const selected = isolatedEnv('/owned', '/selected/runtime/cli/bin/dsh', {}, { executable: '/selected/link/dotnet', root: '/selected/libexec' });
    assert.equal(selected.DOTNET_ROOT, '/selected/libexec');
    assert(selected.PATH.split(path.delimiter).includes('/selected/link'));
    assert(!selected.PATH.includes('ambient-never-inherit'));
    for (const name of ['DOTNET_ROOT_ARM64', 'DOTNET_HOST_PATH']) assert.equal(selected[name], undefined);
    assert.equal(selected.DOTNET_CLI_HOME, '/owned/state/dotnet-home');
    assert.equal(selected.NUGET_PACKAGES, '/owned/deps/nuget-packages');
    assert.equal(selected.NUGET_HTTP_CACHE_PATH, '/owned/cache/nuget-http');
    assert.equal(selected.MSBuildUserExtensionsPath, '/owned/state/msbuild');
    assert.equal(selected.DOTNET_CLI_TELEMETRY_OPTOUT, '1'); assert.equal(selected.DOTNET_SKIP_FIRST_TIME_EXPERIENCE, '1');
  } finally { for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
});
async function versionFixture(mono = true) {
  const w = await fresh(); const paths = {};
  for (const name of ['dsh', 'godot', 'python']) { paths[name] = path.join(w, name); await fs.writeFile(paths[name], '#!/bin/sh\nexit 0\n', { mode: 0o755 }); }
  const calls = [];
  const invoke = async (program, args, options) => {
    calls.push({ program, args, options });
    if (program === paths.dsh) return { output: '0.2.1-rc.2\n' };
    if (program === paths.godot) return { output: '4.7.2.stable.' + (mono ? 'mono.' : '') + 'official.fixture\n' };
    if (program === paths.python) return { output: JSON.stringify({ version: [3, 14, 7], system: 'Darwin', machine: 'arm64', implementation: 'cpython' }) };
    return { output: args[0] === '--list-runtimes' ? 'Microsoft.NETCore.App 10.0.10 [' + path.join(w, 'libexec/shared/Microsoft.NETCore.App') + ']\n' : '10.0.302\n' };
  };
  return { w, paths, calls, invoke };
}
test('Mono Godot without explicit .NET is NO_GO even when all version commands succeed', async () => {
  const { paths, calls, invoke } = await versionFixture();
  const result = await doctor(paths, { run: invoke });
  assert.equal(result.status, 'NO_GO');
  assert.match(result.checks.find(row => row.name === 'runtime versions').detail, /Mono Godot requires an explicit --dotnet/);
  assert.equal(calls.length, 3);
});
test('standard Godot version checks do not require or discover .NET', async () => {
  const { paths, calls, invoke } = await versionFixture(false);
  const result = await doctor(paths, { run: invoke });
  assert.equal(result.status, 'GO'); assert.equal(calls.length, 3);
  assert.equal(result.checks[0].detail.paths.dotnet, undefined);
});
test('explicit .NET preserves invocation symlink, validates version and records resolved root', async () => {
  const { w, paths, calls, invoke } = await versionFixture();
  const root = path.join(w, 'libexec'); await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'host/fxr'), { recursive: true });
  await fs.mkdir(path.join(root, 'shared/Microsoft.NETCore.App'), { recursive: true });
  const real = path.join(root, 'dotnet'); await fs.writeFile(real, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const linked = path.join(w, 'dotnet'); await fs.symlink(real, linked);
  const tools = await probeTools({ ...paths, dotnet: linked }, invoke);
  assert.equal(tools.paths.dotnet, linked); assert.equal(tools.dotnetRoot, root); assert.equal(tools.versions.dotnet, '10.0.302');
  assert.equal(calls.at(-1).args[0], '--list-runtimes'); assert.equal(calls.at(-1).options.env.DOTNET_ROOT, undefined);
  await assert.rejects(probeTools({ ...paths, dotnet: 'dotnet' }, invoke), /existing absolute executable/);
  await assert.rejects(probeTools({ ...paths, dotnet: linked }, async (program, ...args) => program === linked ? { output: 'not-an-sdk-version' } : invoke(program, ...args)), /valid SDK version/);
  await assert.rejects(probeTools({ ...paths, dotnet: linked }, async (program, args, ...options) => program === linked && args[0] === '--list-runtimes' ? { output: 'not-a-runtime-root' } : invoke(program, args, ...options)), /unambiguous installed/);
});
const readyOutput = (id, overrides = {}) => 'Godot Engine\nDSH_GAMEDEV_RUNTIME_READY=' + JSON.stringify({ id, engine: '4.7.2-stable', managed: true, userData: '/task/Application Support/DSH-GameDev/runtime-probe-' + id, ...overrides }) + '\n';
test('runtime readiness requires one matching nonce, runtime kind and unique data path without errors', () => {
  const id = randomUUID(); const valid = readyOutput(id);
  assert.equal(verifyRuntimeReady(valid, id, true).id, id);
  assert.throws(() => verifyRuntimeReady('Godot Engine --version succeeded\n', id, true), /exactly one/);
  assert.throws(() => verifyRuntimeReady(valid + valid, id, true), /exactly one/);
  assert.throws(() => verifyRuntimeReady(readyOutput('wrong-id'), id, true), /identity/);
  assert.throws(() => verifyRuntimeReady(readyOutput(id, { managed: false }), id, true), /managed/);
  assert.throws(() => verifyRuntimeReady(readyOutput(id, { userData: '/existing/game-data' }), id, true), /isolated user data/);
  assert.throws(() => verifyRuntimeReady('SCRIPT ERROR: Parse Error\n' + valid, id, true), /reported an error/);
  assert.throws(() => verifyRuntimeReady('DSH_GAMEDEV_RUNTIME_READY={bad}\n', id, true), /invalid JSON/);
});
test('owned runtime probe is bounded and uses new state, nonce, selected .NET and no game edits', async () => {
  const { w, marker } = await owned();
  marker.tools = { paths: { dsh: '/selected/dsh', dotnet: '/selected/bin/dotnet' }, versions: { godot: '4.7.2.stable.mono.official.fixture' }, dotnetRoot: '/selected/libexec' };
  await fs.writeFile(path.join(w, 'project/keep.gd'), 'original game');
  const probe = await probeRuntime(marker, async (program, args, options) => {
    assert.equal(program, marker.godotCopy); assert.equal(args[0], '--headless');
    assert.deepEqual(args.slice(-3, -1), ['--', '--dsh-gamedev-probe-id']);
    assert.equal(options.timeout, 20_000); assert.equal(options.env.DOTNET_ROOT, '/selected/libexec');
    assert(options.cwd.startsWith(path.join(w, 'state/runtime-probe-')));
    assert.equal(await fs.readFile(path.join(w, 'project/keep.gd'), 'utf8'), 'original game');
    return { output: readyOutput(args.at(-1)), code: 0 };
  });
  assert.equal(probe.managed, true); assert(probe.project.startsWith('state/runtime-probe-'));
  assert.match(await fs.readFile(path.join(w, probe.project, 'project.godot'), 'utf8'), new RegExp('runtime-probe-' + probe.id));
  assert.match(await fs.readFile(path.join(w, probe.log), 'utf8'), /DSH_GAMEDEV_RUNTIME_READY=/);
});
test('exit zero with absent runtime marker fails and retains diagnostics in owned state', async () => {
  const { w, marker } = await owned();
  marker.tools.versions = { godot: '4.7.2.stable.mono.official.fixture' };
  await assert.rejects(probeRuntime(marker, async () => ({ output: 'hostfxr failed before script startup\n', code: 0 })), /readiness failed.*exactly one/);
  const logs = await fs.readdir(path.join(w, 'logs'));
  assert.equal(logs.length, 1); assert.match(await fs.readFile(path.join(w, 'logs', logs[0]), 'utf8'), /hostfxr failed/);
});
test('owned doctor does not execute a rejected Godot copy or probe an active workspace', async () => {
  for (const condition of ['changed-copy', 'active-lock']) {
    const { w, marker } = await owned();
    const fixture = await versionFixture(false);
    marker.tools = await probeTools(fixture.paths, fixture.invoke); fixture.calls.length = 0;
    await fs.mkdir(path.dirname(marker.godotCopy), { recursive: true });
    await fs.writeFile(marker.godotCopy, 'task-only fake copy', { mode: 0o755 });
    await fs.writeFile(path.join(path.dirname(marker.godotCopy), '_sc_'), '');
    marker.godotSHA256 = condition === 'changed-copy' ? hash('different bytes') : hash('task-only fake copy');
    if (condition === 'active-lock') await fs.writeFile(path.join(w, 'state/launch.lock'), '{}');
    await fs.writeFile(path.join(w, '.dsh-gamedev-owner.json'), JSON.stringify(marker));
    const result = await doctor({ workspace: w }, { run: fixture.invoke });
    assert.equal(result.status, 'NO_GO');
    assert.equal(result.checks.find(row => row.name === 'owned headless runtime readiness').status, 'FAIL');
    assert(!fixture.calls.some(row => row.program === marker.godotCopy));
    assert(!(await fs.readdir(path.join(w, 'state'))).some(name => name.startsWith('runtime-probe-')));
  }
});
test('new workspace rejects existing empty, nonempty and symlink directories', async () => {
  const w = await fresh(); await assert.rejects(newWorkspace(w), /already exists/);
  await fs.writeFile(path.join(w, 'keep'), 'original'); await assert.rejects(newWorkspace(w), /already exists/);
  const link = w + '-link'; await fs.symlink(w, link); await assert.rejects(newWorkspace(link), /already exists/);
  assert.equal(await newWorkspace(path.join(w, 'new')), path.join(w, 'new')); await assert.rejects(newWorkspace('relative'), /absolute/);
});
test('executable validation preserves a venv invocation symlink', async () => {
  const w = await fresh(); const exe = path.join(w, 'python3.14'); await fs.writeFile(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const linked = path.join(w, 'python'); await fs.symlink(exe, linked); assert.equal(await absoluteExecutable(linked, 'Python'), linked);
  await assert.rejects(absoluteExecutable('python', 'Python'), /absolute/);
});
test('tarball reader accepts only a compatible built plugin', () => {
  const result = tarMembers(tar(basicFiles())); assert.equal(result.package.version, '0.2.0'); assert.equal(result.files.size, 3);
  assert.throws(() => tarMembers(tar(basicFiles({ name: 'other' }))), /compatible/);
  assert.throws(() => tarMembers(tar(basicFiles({ scripts: { postinstall: 'do something' } }))), /lifecycle/);
});
test('tarball reader rejects traversal, links, duplicate members and truncated bodies', () => {
  assert.throws(() => tarMembers(tar([...basicFiles(), ['package/../outside', 'bad']])), /Unsafe/);
  assert.throws(() => tarMembers(tar([...basicFiles(), ['package/link', '', '2']])), /regular/);
  assert.throws(() => tarMembers(tar([...basicFiles(), ['package/dist/index.js', 'duplicate']])), /Duplicate/);
  assert.throws(() => tarMembers(Buffer.from('not gzip')));
});
test('independent package SHA mismatch prevents installation before any mutation', async () => {
  const w = await fresh(); const bytes = tar(basicFiles()); const file = path.join(w, 'package.tgz'); await fs.writeFile(file, bytes);
  assert.equal((await verifyPackage(file, hash(bytes))).files.size, 3);
  await assert.rejects(verifyPackage(file, '0'.repeat(64)), /SHA256 mismatch/);
});
test('owner marker validation rejects forged root and symlinked owned directories', async () => {
  const { w, marker } = await owned(); assert.equal((await readOwner(w)).id, marker.id);
  await fs.rmdir(path.join(w, 'logs')); await fs.symlink(temp, path.join(w, 'logs')); await assert.rejects(readOwner(w), /symlink/);
});
test('owner marker refuses a profile path redirected into another directory', async () => {
  const { w, profile } = await owned(); await fs.rm(profile, { recursive: true }); await fs.symlink(temp, profile);
  await assert.rejects(readOwner(w), /linked or outside/);
});
test('observed editor paths must actually resolve inside workspace', async () => {
  const w = await fresh(); const data = path.join(w, 'editor_data'); await fs.mkdir(data); const marker = path.join(w, '_sc_'); await fs.writeFile(marker, '');
  const good = { data, config: data, cache: data, selfContained: true, marker };
  assert.equal((await verifyEditorPaths(w, good)).data, data);
  await assert.rejects(verifyEditorPaths(w, { ...good, data: temp }), /outside/);
  const link = path.join(w, 'linked'); await fs.symlink(temp, link); await assert.rejects(verifyEditorPaths(w, { ...good, cache: link }), /outside/);
  await assert.rejects(verifyEditorPaths(w, { ...good, selfContained: false }), /self-contained/);
});
test('generated native patch keeps one preset, explicit approval and disabled optional tools', async () => {
  const { marker } = await owned(); const patch = profilePatch(marker);
  assert.match(patch, /"mode":"workspace-write"/); assert.match(patch, /policy: ask/); assert.match(patch, /"allowedOptionalTools":\[\]/);
  assert.match(patch, /DSH_GAMEDEV_BRIDGE_TOKEN/); assert(!patch.includes('secret value')); assert(!patch.includes('agent-team')); assert(!patch.includes('danger-full-access'));
});
test('structured process execution never interprets shell syntax in arguments', async () => {
  const dangerous = '$(touch /never-create-this) `echo secret` ; & spaces';
  const result = await run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', dangerous], { env: {}, timeout: 5000 });
  assert.deepEqual(JSON.parse(result.output), [dangerous]);
});
test('failed runtime readiness reports NO_GO without invoking unavailable programs', async () => {
  let called = 0; const result = await doctor({ dsh: '/missing-dsh', godot: '/missing-godot', python: '/missing-python' }, { run: async () => { called++; } });
  assert.equal(result.status, 'NO_GO'); assert.equal(called, 0); assert(result.checks.some(x => x.name === 'runtime versions' && x.status === 'FAIL'));
});
test('occupied port is refused and its existing listener remains alive', async () => {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(assertFree(server.address().port), /occupied/); assert.equal(server.listening, true); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
test('uninstall refuses a duplicate owned id before native CLI or deletion', parserTests, async () => {
  const { w, profile } = await owned(); await fs.appendFile(path.join(profile, 'cordis.patch.yml'), '# user edits\n- id: gamedev-settings\n  name: dsh-gamedev\n');
  let calls = 0; await assert.rejects(uninstall({ workspace: w }, { run: async () => { calls++; return { output: '' }; } }), /duplicate_row_id/);
  assert.equal(calls, 0); assert.match(await fs.readFile(path.join(profile, 'cordis.patch.yml'), 'utf8'), /# user edits/);
  assert.equal(await fs.stat(path.join(w, 'state/launch.lock')).then(() => true, () => false), false);
});
test('uninstall uses native remove and retains game, saves, engine and other overrides', parserTests, async () => {
  const { w, profile, patch } = await owned(); const game = path.join(w, 'project/game.gd'); await fs.writeFile(game, 'user-owned-game');
  const calls = []; const result = await uninstall({ workspace: w }, { run: async (program, args, options) => { calls.push({ program, args, options }); return { output: 'removed\n', code: 0 }; } });
  assert.equal(result.status, 'UNINSTALLED'); assert.equal(calls[0].program, '/fake/dsh'); assert.deepEqual(calls[0].args, ['plugin', '--profile', 'gamedev-isolated', 'remove', 'dsh-gamedev']);
  assert.equal(calls[0].options.env.DSH_HOME, path.join(w, 'dsh-home')); assert.equal(await fs.readFile(game, 'utf8'), 'user-owned-game');
  assert.equal(await fs.readFile(path.join(profile, 'cordis.patch.yml.before-uninstall'), 'utf8'), patch);
  const after = await fs.readFile(path.join(profile, 'cordis.patch.yml'), 'utf8'); assert(!after.includes('gamedev-settings')); assert(after.includes('sandbox-policy')); assert(after.includes('approval'));
  assert.equal((await readOwner(w)).state, 'UNINSTALLED'); assert.equal((await uninstall({ workspace: w })).status, 'ALREADY_UNINSTALLED');
});
async function removalFixture(source) {
  const context = await owned(); const file = path.join(context.profile, 'cordis.patch.yml');
  await fs.writeFile(file, source); return { ...context, file, source: Buffer.from(source) };
}
test('AST removal preserves onboarding, other rows, comments and multiline quoted paths byte for byte', parserTests, async () => {
  const before = '# retained header\n- id: sandbox-policy\n  config: {mode: workspace-write}\n# before owned row\n';
  const own = String.raw`- id: gamedev-settings
  name: dsh-gamedev
  config:
    projectRoot: "/task/艺术项目\\folder\nsecond line"
    description: >-
      User edited this configuration
      over several lines.
    enabled: false`;
  const after = '\n# unrelated next-row comment\n- id: ui-settings-general\n  config: {welcomeNoticeVersion: "0.2.1-rc.2"}\n- id: user-plugin\n  config:\n    note: |\n      - id: gamedev-settings\n      name: dsh-gamedev is only literal user text\n';
  const { marker, file, source } = await removalFixture(before + own + after);
  const plan = await planOverrideRemoval(marker, file, source);
  assert.equal(plan.changed, true); assert.equal(plan.replacement.toString(), before + after);
  assert.equal(await fs.readFile(file, 'utf8'), before + own + after);
});
test('AST removal supports flow sequences and a lone owned row without normalizing other bytes', parserTests, async () => {
  const cases = [
    ['[{id: keep1}, {id: gamedev-settings, name: dsh-gamedev}, {id: keep2}]\n', '[{id: keep1},  {id: keep2}]\n'],
    ['[{id: gamedev-settings, name: dsh-gamedev}, {id: keep2}]\n', '[ {id: keep2}]\n'],
    ['[{id: keep1}, {id: gamedev-settings, name: dsh-gamedev}]\n', '[{id: keep1}]\n'],
    ['# header\r\n- id: gamedev-settings\r\n  name: dsh-gamedev\r\n# footer\r\n', '# header\r\n[]\r\n# footer\r\n'],
    ['# unchanged\n[]\n', '# unchanged\n[]\n'],
  ];
  for (const [source, expected] of cases) {
    const fixture = await removalFixture(source);
    const plan = await planOverrideRemoval(fixture.marker, fixture.file, fixture.source);
    assert.equal(plan.replacement.toString(), expected);
  }
});
for (const [label, source, refusal] of [
  ['rebound owned id', '- id: gamedev-settings\n  name: different-plugin\n', 'owned_id_rebound'],
  ['ambiguous owned name', '- id: different-id\n  name: dsh-gamedev\n', 'ambiguous_owned_name'],
  ['duplicate other row id', '- id: repeated\n- id: repeated\n', 'duplicate_row_id'],
  ['duplicate nested key', '- id: gamedev-settings\n  name: dsh-gamedev\n  config: {key: one, key: two}\n', 'duplicate_mapping_key'],
  ['malformed YAML', '- id: gamedev-settings\n  name: dsh-gamedev\n  config: [PRIVATE_SENTINEL\n', 'invalid_yaml'],
  ['multiple documents', '- id: one\n---\n- id: two\n', 'multiple_documents'],
  ['aliases and anchors', '- id: one\n  config: &shared {key: PRIVATE_SENTINEL}\n- id: two\n  config: *shared\n', 'aliases_or_anchors'],
  ['unsafe YAML tag', '- id: one\n  config: !!python/object/apply:os.system [PRIVATE_SENTINEL]\n', 'unsupported_tag'],
  ['mapping root', 'id: gamedev-settings\nname: dsh-gamedev\n', 'root_not_sequence'],
]) test('AST removal refuses ' + label + ' without exposing config values', parserTests, async () => {
  const fixture = await removalFixture(source);
  await assert.rejects(planOverrideRemoval(fixture.marker, fixture.file, fixture.source), error => error.message.includes(refusal) && !error.message.includes('PRIVATE_SENTINEL'));
  assert.equal(await fs.readFile(fixture.file, 'utf8'), source);
});
test('uninstall re-parses native CLI changes and preserves its new unrelated rows', parserTests, async () => {
  const before = '- id: ui-settings-general\n  config: {welcomeNoticeVersion: "new"}\n';
  const own = '- id: gamedev-settings\n  name: dsh-gamedev\n  config: {enabled: false, projectRoot: "/edited/game"}';
  const tail = '\n# user override\n- id: user-plugin\n  config: {keep: true}\n';
  const fixture = await removalFixture(before + own + tail);
  const addedByNative = '- id: another-plugin\n  config: {native: true}\n';
  await uninstall({ workspace: fixture.w }, { run: async () => {
    assert.equal(await fs.readFile(fixture.file + '.before-uninstall', 'utf8'), before + own + tail);
    await fs.appendFile(fixture.file, addedByNative); return { output: 'removed\n' };
  } });
  assert.equal(await fs.readFile(fixture.file, 'utf8'), before + tail + addedByNative);
});
test('native CLI may already remove the owned row and its current patch is not rewritten', parserTests, async () => {
  const fixture = await owned(); const file = path.join(fixture.profile, 'cordis.patch.yml');
  const remaining = '# native current formatting\n- id: ui-settings-general\n  config: {welcomeNoticeVersion: "new"}\n'; let nativeInode;
  await uninstall({ workspace: fixture.w }, { run: async () => {
    await fs.writeFile(file, remaining); nativeInode = (await fs.stat(file)).ino; return { output: 'removed\n' };
  } });
  assert.equal(await fs.readFile(file, 'utf8'), remaining); assert.equal((await fs.stat(file)).ino, nativeInode);
});
test('failed native uninstall retains exact backup and permits a safe retry with a fresh backup', parserTests, async () => {
  const fixture = await owned(); let calls = 0;
  const hooks = { run: async () => { if (++calls === 1) throw new Error('synthetic native remove failure'); return { output: 'removed\n' }; } };
  await assert.rejects(uninstall({ workspace: fixture.w }, hooks), /synthetic native remove failure/);
  assert.equal((await readOwner(fixture.w)).state, 'READY');
  assert.equal(await fs.readFile(path.join(fixture.profile, 'cordis.patch.yml.before-uninstall'), 'utf8'), fixture.patch);
  await uninstall({ workspace: fixture.w }, hooks);
  const backups = (await fs.readdir(fixture.profile)).filter(file => file.startsWith('cordis.patch.yml.before-uninstall'));
  assert.equal(backups.length, 2); assert.equal(calls, 2);
  for (const file of backups) assert.equal(await fs.readFile(path.join(fixture.profile, file), 'utf8'), fixture.patch);
});
test('uninstall refuses malformed YAML before calling the native CLI', parserTests, async () => {
  const fixture = await removalFixture('- id: gamedev-settings\n  name: dsh-gamedev\n  config: [PRIVATE_SENTINEL\n'); let calls = 0;
  await assert.rejects(uninstall({ workspace: fixture.w }, { run: async () => { calls++; return { output: '' }; } }), /invalid_yaml/);
  assert.equal(calls, 0); assert.equal(await fs.readFile(fixture.file, 'utf8'), fixture.source.toString());
});
test('uninstall preserves a concurrent post-parse edit instead of overwriting it', parserTests, async () => {
  const fixture = await owned(); const file = path.join(fixture.profile, 'cordis.patch.yml'); let parsed = 0;
  const concurrent = '# concurrent user edit\n- id: user-added\n  config: {keep: true}\n';
  await assert.rejects(uninstall({ workspace: fixture.w }, {
    run: async () => ({ output: 'removed\n' }),
    parserRun: async (...args) => { const result = await run(...args); if (++parsed === 2) await fs.appendFile(file, concurrent); return result; },
  }), /changed before replacement/);
  assert.equal(await fs.readFile(file, 'utf8'), fixture.patch + concurrent);
  assert.equal((await readOwner(fixture.w)).state, 'READY');
  assert(!(await fs.readdir(fixture.profile)).some(name => name.endsWith('.next')));
});
test('active launch lock prevents uninstall without killing or touching anything', async () => {
  const { w, profile, patch } = await owned(); await fs.writeFile(path.join(w, 'state/launch.lock'), '{}');
  let calls = 0; await assert.rejects(uninstall({ workspace: w }, { run: async () => { calls++; } }), /lock exists/);
  assert.equal(calls, 0); assert.equal(await fs.readFile(path.join(profile, 'cordis.patch.yml'), 'utf8'), patch);
});
test('prepare requires an explicit network/offline choice before creating workspace', async () => {
  const w = path.join(await fresh(), 'new-workspace'); await assert.rejects(prepare({ workspace: w }), /Choose --offline explicitly/);
  assert.equal(await fs.stat(w).then(() => true, () => false), false);
  await assert.rejects(prepare({ workspace: w, offline: true, 'allow-download': true }), /not both/);
});
test('offline prepare fails explicitly on a missing pinned artifact, without download or fallback install', async () => {
  const w = await fresh(); const source = path.join(w, 'wheelhouse'); await fs.mkdir(source);
  const tools = {};
  for (const name of ['dsh', 'godot', 'python']) { tools[name] = path.join(w, name); await fs.writeFile(tools[name], '#!/bin/sh\nexit 0\n', { mode: 0o755 }); }
  const lock = 'sample==1.0 \\\n --hash=sha256:' + '1'.repeat(64) + '\n';
  const ledger = {
    core: [
      { url: 'https://github.com/hybridindie/godot-mcp/releases/download/2026.10.20.1/godot_editor_mcp-2026.10.20.1-py3-none-any.whl', sha256: 'cb32961dd87d983a55ba94ea3357e3ebdb540f5fe9e543e41e35353fbe51b640' },
      { url: 'https://github.com/hybridindie/godot-mcp/releases/download/2026.10.20.1/godot_mcp_addon.zip', sha256: '7173bb197eca2a8522b2173342ce474052d7746c3b36a9d404e554ae8cc1fbaf' },
    ],
    pythonDistributions: [{ name: 'sample', artifact: { filename: 'sample-1.0-py3-none-any.whl', url: 'https://files.pythonhosted.org/packages/sample-1.0-py3-none-any.whl', sha256: '1'.repeat(64), type: 'wheel' } }],
  };
  const bytes = tar([...basicFiles(), ['package/locks/bridge-requirements.lock', lock], ['package/resolved-dependencies.json', JSON.stringify(ledger)]]);
  const file = path.join(w, 'package.tgz'); await fs.writeFile(file, bytes); const workspace = path.join(w, 'new');
  const called = []; const originalFetch = globalThis.fetch; let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('unexpected network'); };
  try {
    await assert.rejects(prepare({ workspace, ...tools, package: file, 'package-sha256': hash(bytes), offline: true, 'find-links': source, port: '58031', 'bridge-port': '58032' }, {
      run: async (program, args) => {
        called.push([program, args]);
        if (program === tools.dsh) return { output: '0.2.1-rc.2\n' };
        if (program === tools.godot) return { output: '4.7.2.stable.official.fake\n' };
        return { output: JSON.stringify({ version: [3, 14, 7], system: 'Darwin', machine: 'arm64', implementation: 'cpython' }) };
      },
    }), /Offline artifact missing: godot_editor_mcp/);
    assert.equal(fetched, false); assert.equal(called.length, 3); assert(called.every(([, args]) => args[0] === '--version' || args[0] === '-I'));
    const marker = await readOwner(workspace); assert.equal(marker.state, 'FAILED'); assert.match(marker.failure, /Offline artifact missing/);
    assert.deepEqual(await fs.readdir(path.join(workspace, 'deps/downloads')), []);
  } finally { globalThis.fetch = originalFetch; }
});


test('artifact download retries transient GET failures only and verifies final bytes', async () => {
  const w = await fresh(); const data = Buffer.from('synthetic wheel bytes');
  const artifact = { filename: 'synthetic.whl', url: 'https://files.pythonhosted.org/synthetic.whl', sha256: hash(data) };
  let calls = 0;
  const request = async () => {
    if (++calls === 1) throw new Error('synthetic transient network timeout');
    return { ok: true, url: artifact.url, headers: new Map(), body: [data] };
  };
  const installed = await downloadArtifact(artifact, w, null, true, request);
  assert.equal(calls, 2); assert.deepEqual(await fs.readFile(installed), data);
  let badCalls = 0;
  await assert.rejects(downloadArtifact({ ...artifact, filename: 'bad.whl' }, w, null, true, async () => {
    badCalls++; return { ok: true, url: artifact.url, headers: new Map(), body: [Buffer.from('corrupt')] };
  }), /SHA256 mismatch/);
  assert.equal(badCalls, 1); assert.equal(await fs.stat(path.join(w, 'bad.whl')).then(() => true, () => false), false);
});
test('permanent download error identifies the fixed artifact and does not retry', async () => {
  const w = await fresh(); let calls = 0;
  await assert.rejects(downloadArtifact({ filename: 'missing.whl', url: 'https://files.pythonhosted.org/missing.whl', sha256: '0'.repeat(64) }, w, null, true, async () => {
    calls++; return { ok: false, status: 404 };
  }), /missing\.whl.*attempt 1\/3.*HTTP 404/);
  assert.equal(calls, 1);
});
