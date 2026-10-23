import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, existsSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, executable, project, probe, validateSettings, mapProductSettings, fingerprint, optionalStatus, loopback, publicToolName, verifyBridgePython } from '../dist/config.js';

// These finite local programs exercise path/argv/version behavior only. They are
// not Godot/MCP mocks used to claim real engine or model acceptance.
let fixture, projectRoot, godotProgram, wrongGodotProgram, cliProgram, argvProgram, bridgeProgram;
const binary = (path, body) => {
  writeFileSync(path, '#!/bin/sh\n' + body + '\n');
  chmodSync(path, 0o755);
  return path;
};
before(() => {
  fixture = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-gamedev-config-')));
  projectRoot = join(fixture, 'game root');
  mkdirSync(projectRoot);
  writeFileSync(join(projectRoot, 'project.godot'), 'config_version=5\n');
  godotProgram = binary(join(fixture, 'Godot ; fixture'), "printf '%s\\n' '4.7.2.stable.mono.official.fixture'");
  wrongGodotProgram = binary(join(fixture, 'Wrong Godot'), "printf '%s\\n' '4.8.0.stable.official.fixture'");
  cliProgram = binary(join(fixture, 'Optional CLI'), "printf '%s\\n' 'fixture-cli 1.2.3'");
  argvProgram = binary(join(fixture, 'argv $(literal)'), "printf '%s\\n' \"$@\"");
  // A finite argv/version contract fixture named python; this is deliberately
  // not represented as an actual Python interpreter or bridge installation.
  bridgeProgram = binary(join(fixture, 'python'), "[ \"$1\" = '-I' ] && [ \"$2\" = '-B' ] && [ \"$3\" = '-c' ] || exit 23\nprintf '%s\\n' '2026.10.20.1|2026.10.20.1'");
});
after(() => rmSync(fixture, { recursive: true, force: true }));

const enabled = (changes = {}) => ({
  ...DEFAULTS,
  enabled: true,
  projectRoot,
  godotExecutable: godotProgram,
  bridgeExecutable: bridgeProgram,
  bridgeSecretRef: 'GAMEDEV_CONFIG_TEST_TOKEN_REF',
  ...changes,
});

test('safe unconfigured defaults remain disabled without requiring programs', () => {
  const result = validateSettings({});
  assert.equal(result.enabled, false);
  assert.equal(result.projectRoot, '');
  assert.deepEqual(result.allowedOptionalTools, []);
  assert.equal(result.health, '');
});

test('valid configuration canonicalizes project and executable symlinks without mutating input', () => {
  const alias = join(fixture, 'project alias');
  symlinkSync(projectRoot, alias);
  const engineAlias = join(fixture, 'engine alias');
  symlinkSync(godotProgram, engineAlias);
  const input = enabled({ projectRoot: alias, godotExecutable: engineAlias });
  const snapshot = structuredClone(input);
  const result = validateSettings(input);
  assert.equal(result.projectRoot, realpathSync(projectRoot));
  assert.equal(result.godotExecutable, realpathSync(godotProgram));
  assert.deepEqual(input, snapshot);
});

test('invalid relative, missing, non-project and non-executable paths are rejected', () => {
  const plain = join(fixture, 'not executable');
  writeFileSync(plain, 'data');
  chmodSync(plain, 0o644);
  assert.throws(() => project('relative/game'));
  assert.throws(() => project(join(fixture, 'missing')));
  assert.throws(() => project(fixture));
  assert.throws(() => executable('relative/program', 'Fixture'));
  assert.throws(() => executable(plain, 'Fixture'));
  assert.throws(() => executable(fixture, 'Fixture'));
  assert.throws(() => validateSettings(enabled({ projectRoot: fixture })));
});

test('Godot patch version is checked from the configured executable', () => {
  assert.equal(validateSettings(enabled()).enabled, true);
  assert.throws(() => validateSettings(enabled({ godotExecutable: wrongGodotProgram })), /4\.7\.2/);
});

test('bridge Python invocation preserves a venv-like symlink and requires the pinned imports/version', () => {
  const alias = join(fixture, 'venv-python-alias');
  symlinkSync(bridgeProgram, alias);
  assert.equal(validateSettings(enabled({ bridgeExecutable: alias })).bridgeExecutable, alias);
  const wrongDir = join(fixture, 'wrong bridge');
  mkdirSync(wrongDir);
  const wrong = binary(join(wrongDir, 'python3'), "printf '%s\\n' '2026.10.19.1|2026.10.19.1'");
  assert.throws(() => verifyBridgePython(wrong), /pinned.*2026\.10\.20\.1/);
});

test('console entrypoint is refused before execution instead of silently bypassing the guard', () => {
  const marker = join(fixture, 'console entrypoint executed');
  const quotedMarker = "'" + marker.replaceAll("'", "'\\''") + "'";
  const entrypoint = binary(join(fixture, 'godot-editor-mcp'), 'touch ' + quotedMarker + "\nprintf '%s\\n' '2026.10.20.1|2026.10.20.1'");
  assert.throws(() => verifyBridgePython(entrypoint), /Python.*console entrypoint/);
  assert.equal(existsSync(marker), false);
});

test('bridge import probe drops unrelated environment values without printing them', () => {
  const dir = join(fixture, 'environment probe');
  mkdirSync(dir);
  const observed = join(dir, 'environment-visible-boolean');
  const quoted = "'" + observed.replaceAll("'", "'\\''") + "'";
  const program = binary(join(dir, 'python'), '[ -n "${GAMEDEV_CONFIG_TEST_UNRELATED_SENTINEL+x}" ] && seen=1 || seen=0\nprintf \'%s\\n\' "$seen" > ' + quoted + "\nprintf '%s\\n' '2026.10.20.1|2026.10.20.1'");
  const previous = process.env.GAMEDEV_CONFIG_TEST_UNRELATED_SENTINEL;
  process.env.GAMEDEV_CONFIG_TEST_UNRELATED_SENTINEL = '1';
  try { verifyBridgePython(program); }
  finally {
    if (previous === undefined) delete process.env.GAMEDEV_CONFIG_TEST_UNRELATED_SENTINEL;
    else process.env.GAMEDEV_CONFIG_TEST_UNRELATED_SENTINEL = previous;
  }
  assert.equal(readFileSync(observed, 'utf8').trim(), '0');
});

test('loopback accepts explicit local HTTP and WS, including IPv6', () => {
  for (const value of ['http://127.0.0.1:19876/mcp', 'http://localhost:19876/mcp', 'http://[::1]:19876/mcp']) {
    assert.equal(loopback(value).href, value);
  }
  assert.equal(validateSettings(enabled({ bridgeUrl: 'ws://[::1]:19876' })).bridgeUrl, 'ws://[::1]:19876');
});

test('existing HTTP cannot be activated without native per-request redirect confinement', () => {
  assert.throws(() => validateSettings(enabled({ bridgeMode: 'existing-loopback-http', bridgeEndpoint: 'http://127.0.0.1:19876/mcp' })), /unavailable|redirect confinement/i);
});

test('remote, credentialed, query, fragment, unsupported scheme and portless WS endpoints are rejected', () => {
  const badHttp = ['http://example.com/mcp', 'https://127.0.0.1:19876/mcp', 'http://127.0.0.1.example.com/mcp', 'http://user:secret@127.0.0.1:19876/mcp', 'http://127.0.0.1:19876/mcp?token=x', 'http://127.0.0.1:19876/mcp#fragment', 'file:///tmp/mcp'];
  for (const value of badHttp) assert.throws(() => validateSettings(enabled({ bridgeMode: 'existing-loopback-http', bridgeEndpoint: value })), undefined, value);
  for (const value of ['ws://example.com:19876', 'wss://127.0.0.1:19876', 'ws://127.0.0.1', 'ws://user:secret@127.0.0.1:19876']) {
    assert.throws(() => validateSettings(enabled({ bridgeUrl: value })), undefined, value);
  }
});

test('secret configuration accepts reference names and rejects inline credential forms', () => {
  assert.equal(validateSettings(enabled({ bridgeSecretRef: 'GAMEDEV_TEST_REFERENCE' })).bridgeSecretRef, 'GAMEDEV_TEST_REFERENCE');
  for (const reference of ['Bearer fixture-token', 'a=b', 'inline-token-value-with-dashes', '${TOKEN}', 'A.B']) {
    assert.throws(() => validateSettings(enabled({ bridgeSecretRef: reference })), /references/);
  }
});

test('invalid configuration never mutates the previous valid object', () => {
  const previous = validateSettings(enabled());
  const snapshot = structuredClone(previous);
  assert.throws(() => validateSettings({ ...previous, bridgeEndpoint: 'http://remote.invalid/mcp' }));
  assert.deepEqual(previous, snapshot);
});

test('disabling remains available after required project and engine paths disappear', () => {
  const result = validateSettings(enabled({ enabled: false, projectRoot: join(fixture, 'missing game'), godotExecutable: join(fixture, 'missing engine'), bridgeExecutable: join(fixture, 'missing python') }));
  assert.equal(result.enabled, false);
});

test('disabling remains available when a previously configured optional program disappears', () => {
  const former = binary(join(fixture, 'removed optional'), "printf '%s\\n' 'fixture 1.0'");
  const previous = validateSettings(enabled({ ffmpegExecutable: former, allowedOptionalTools: ['ffmpeg'] }));
  rmSync(former);
  assert.doesNotThrow(() => {
    const result = validateSettings({ ...previous, enabled: false });
    assert.equal(result.enabled, false);
  });
});

test('probe passes executable paths and argv literally rather than evaluating a shell command', () => {
  const marker = join(fixture, 'must-not-be-created');
  const payload = `$(touch ${marker}); touch ${marker}`;
  const result = probe(argvProgram, [payload]);
  assert.equal(result.ready, true);
  assert.equal(result.version, payload);
  assert.equal(existsSync(marker), false);
  assert.equal(probe(join(fixture, 'absent')).ready, false);
});

test('optional capability requires explicit allow plus a successful existing-program probe', () => {
  const configured = validateSettings({ ...DEFAULTS, gdtoolkitExecutable: cliProgram, imagemagickExecutable: cliProgram, allowedOptionalTools: ['imagemagick', 'ffmpeg', 'gua'] });
  const statuses = optionalStatus(configured);
  assert.equal(statuses.gdtoolkit.status, 'DISABLED');
  assert.equal(statuses.imagemagick.status, 'READY');
  assert.equal(statuses.imagemagick.version, 'fixture-cli 1.2.3');
  assert.equal(statuses.ffmpeg.status, 'UNAVAILABLE');
  assert.equal(statuses.gua.status, 'UNAVAILABLE');
  assert.throws(() => validateSettings({ ...DEFAULTS, allowedOptionalTools: ['ffmpeg', 'ffmpeg'] }));
  assert.throws(() => validateSettings({ ...DEFAULTS, allowedOptionalTools: ['unknown'] }));
});

test('missing optional absolute program does not prevent core enable and is reported unavailable', () => {
  const result = validateSettings(enabled({ ffmpegExecutable: join(fixture, 'missing optional'), allowedOptionalTools: ['ffmpeg'] }));
  assert.equal(result.enabled, true);
  assert.equal(optionalStatus(result).ffmpeg.status, 'UNAVAILABLE');
});

test('product schema example maps to disabled native fields without leaking health or nested bridge', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const example = JSON.parse(readFileSync(join(root, 'contracts/settings.example.json'), 'utf8'));
  const native = validateSettings(mapProductSettings(example));
  assert.equal(native.enabled, false);
  assert.equal(native.projectRoot, '');
  assert.equal(native.bridgeMode, 'stdio');
  assert.equal(native.bridgeUrl, DEFAULTS.bridgeUrl);
  assert.equal(native.bridgeSecretRef, '');
  assert.equal('bridge' in native, false);
  assert.deepEqual(native.allowedOptionalTools, []);
  assert.equal(validateSettings({ ...native, health: 'untrusted client diagnostics' }).health, '');
});

test('product mapping preserves an enabled binding and separate bridge/HTTP references', () => {
  const mapped = mapProductSettings({ schemaVersion: 1, enabled: true, projectRoot, godotExecutable: godotProgram, bridge: { id: 'godot-editor-mcp', mode: 'stdio', executable: bridgeProgram, endpoint: null, bridgeUrl: 'ws://127.0.0.1:19876', bridgeSecretRef: 'BRIDGE_REFERENCE', httpSecretRef: 'HTTP_REFERENCE' }, allowedOptionalTools: [], testFrameworkPreference: 'existing' });
  const result = validateSettings(mapped);
  assert.equal(result.projectRoot, projectRoot);
  assert.equal(result.bridgeExecutable, bridgeProgram);
  assert.equal(result.bridgeSecretRef, 'BRIDGE_REFERENCE');
  assert.equal(result.httpSecretRef, 'HTTP_REFERENCE');
});

test('binding generation changes for targets but ignores enable, health and allowlist toggles', () => {
  const settings = validateSettings(enabled());
  assert.equal(fingerprint(settings), fingerprint({ ...settings, enabled: false, health: 'changed', allowedOptionalTools: ['ffmpeg'] }));
  assert.equal(fingerprint(settings), fingerprint({ ...settings, ffmpegExecutable: join(fixture, 'other ffmpeg'), imagemagickExecutable: join(fixture, 'other magick'), testFrameworkPreference: 'none' }));
  assert.notEqual(fingerprint(settings), fingerprint({ ...settings, bridgeUrl: 'ws://127.0.0.1:19877' }));
  assert.notEqual(fingerprint(settings), fingerprint({ ...settings, projectRoot: join(fixture, 'other project') }));
});

test('reviewed long upstream tool uses the pinned native public name instead of reverse parsing', () => {
  assert.equal(publicToolName('godot_health_check'), 'mcp__gamedev_godot__godot_health_check');
  assert.equal(publicToolName('godot_asset_import_create_material_from_textures'), 'mcp__gamedev_godot__godot_asset_import_create_mater_89b53889091a');
  assert.equal(publicToolName('godot_asset_import_create_material_from_textures').length, 64);
});
