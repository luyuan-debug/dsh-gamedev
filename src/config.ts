import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const VERSION = '0.2.0';
export const PRESET_ID = 'godot-2d';
export const SERVER_NAME = 'gamedev_godot';
export const OPTIONAL_IDS = ['gdtoolkit', 'imagemagick', 'ffmpeg', 'pixelorama', 'gua', 'dcc-mcp', 'tiled', 'ldtk'] as const;
export type Settings = {
  enabled: boolean; projectRoot: string; godotExecutable: string;
  bridgeMode: 'stdio' | 'existing-loopback-http'; bridgeExecutable: string;
  bridgeUrl: string; bridgeEndpoint: string; bridgeSecretRef: string; httpSecretRef: string;
  allowedOptionalTools: string[]; gdtoolkitExecutable: string; imagemagickExecutable: string;
  ffmpegExecutable: string; testFrameworkPreference: string; health: string;
};
export const DEFAULTS: Settings = {
  enabled: false, projectRoot: '', godotExecutable: '', bridgeMode: 'stdio', bridgeExecutable: '',
  bridgeUrl: 'ws://127.0.0.1:19080', bridgeEndpoint: '', bridgeSecretRef: '', httpSecretRef: '',
  allowedOptionalTools: [], gdtoolkitExecutable: '', imagemagickExecutable: '', ffmpegExecutable: '',
  testFrameworkPreference: 'existing', health: '',
};
export function loopback(input: string, websocket = false): URL {
  const url = new URL(input);
  if (!(websocket ? ['ws:'] : ['http:']).includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password ||
      url.search || url.hash || (websocket && !url.port)) throw new Error('Endpoint must be explicit loopback, without credentials, query or fragment.');
  return url;
}
export function executable(input: string, label: string): string {
  if (!isAbsolute(input)) throw new Error(`${label}: select an existing absolute executable path.`);
  const path = realpathSync(input);
  if (!statSync(path).isFile()) throw new Error(`${label}: not a file.`);
  accessSync(path, constants.X_OK);
  return path;
}
export function project(input: string): string {
  if (!isAbsolute(input)) throw new Error('Project root must be an existing absolute path.');
  const path = realpathSync(input);
  if (!statSync(path).isDirectory() || !existsSync(join(path, 'project.godot'))) throw new Error('Project root must contain project.godot.');
  return path;
}
export function probe(path: string, args = ['--version']): { ready: boolean; version: string; reason: string } {
  if (!path) return { ready: false, version: '', reason: 'Not configured; no installation attempted.' };
  try {
    const command = executable(path, 'Program');
    const output = execFileSync(command, args, { encoding: 'utf8', timeout: 4000, maxBuffer: 131072, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ready: true, version: output.split('\n').filter(Boolean)[0]?.trim() ?? '', reason: '' };
  } catch { return { ready: false, version: '', reason: 'Version check failed or timed out.' }; }
}
export function verifyBridgePython(input: string): void {
  const resolved = executable(input, 'Bridge Python');
  if (!/^python(?:[0-9]+(?:\.[0-9]+)*)?(?:\.exe)?$/i.test(basename(resolved))) throw new Error('Bridge executable must be the isolated environment Python, not the godot-editor-mcp console entrypoint.');
  try {
    const result = execFileSync(input, ['-I', '-B', '-c', 'import importlib.metadata,mcp_server,fastmcp;print(importlib.metadata.version("godot-editor-mcp")+"|"+mcp_server.__version__)'], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4096, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), FASTMCP_CHECK_FOR_UPDATES: 'off', FASTMCP_SHOW_SERVER_BANNER: 'false' },
    }).trim();
    if (result !== '2026.10.20.1|2026.10.20.1') throw new Error('version mismatch');
  } catch { throw new Error('Bridge Python must import the pinned godot-editor-mcp 2026.10.20.1 and its dependencies from its existing isolated environment.'); }
}
export function validateSettings(value: Partial<Settings>): Settings {
  const next = { ...DEFAULTS, ...value, health: '' };
  if (typeof next.enabled !== 'boolean') throw new Error('enabled must be boolean.');
  for (const key of Object.keys(DEFAULTS)) {
    if (key !== 'enabled' && key !== 'allowedOptionalTools' && typeof next[key as keyof Settings] !== 'string') throw new Error(`${key} must be a string.`);
  }
  if (!['stdio', 'existing-loopback-http'].includes(next.bridgeMode)) throw new Error('Unsupported bridge mode.');
  if (!['existing', 'none', 'gut', 'gdunit4'].includes(next.testFrameworkPreference)) throw new Error('Invalid framework preference.');
  if (!Array.isArray(next.allowedOptionalTools) || new Set(next.allowedOptionalTools).size !== next.allowedOptionalTools.length || next.allowedOptionalTools.some(x => !OPTIONAL_IDS.includes(x as any))) throw new Error('Invalid optional tool selection.');
  for (const ref of [next.bridgeSecretRef, next.httpSecretRef]) if (ref && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('Secret references must be environment variable names, never token values.');
  if (next.bridgeUrl) loopback(next.bridgeUrl, true);
  if (next.bridgeEndpoint) loopback(next.bridgeEndpoint);
  // Disabling remains possible even when a previously selected program/project disappeared.
  if (next.enabled) {
    next.projectRoot = project(next.projectRoot);
    next.godotExecutable = executable(next.godotExecutable, 'Godot');
    const engine = probe(next.godotExecutable);
    if (!engine.ready || !/^4\.7\.2\.stable(?:\.|$)/.test(engine.version)) throw new Error('Godot 4.7.2 stable is required. Existing software will not be upgraded.');
    if (next.bridgeMode === 'stdio') {
      // Validate the resolved file but retain a venv's invocation path: realpath would discard its site-packages.
      verifyBridgePython(next.bridgeExecutable);
      if (!next.bridgeSecretRef) throw new Error('A bridge token environment reference is required.');
      loopback(next.bridgeUrl, true);
    } else throw new Error('Existing HTTP is unavailable in this release: the native client cannot guarantee redirect confinement. Use the guarded stdio bridge.');
  }
  if (next.enabled) for (const key of ['gdtoolkitExecutable', 'imagemagickExecutable', 'ffmpegExecutable'] as const) if (next[key] && !isAbsolute(next[key])) throw new Error(`${key} must be an absolute path; missing optional programs are reported as unavailable.`);
  return next;
}
export function fingerprint(settings: Settings): string {
  const { enabled, health, allowedOptionalTools, gdtoolkitExecutable, imagemagickExecutable, ffmpegExecutable, testFrameworkPreference, ...binding } = settings;
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex').slice(0, 16);
}
/** Exact native DSH 0.2.1-rc.2 naming contract; never reverse-parse a public name. */
export function publicToolName(rawName: string): string {
  const joined = `mcp__${SERVER_NAME}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = createHash('sha256').update(`${SERVER_NAME}\0${rawName}`).digest('hex').slice(0, 12);
  return `${normalized.slice(0, 51)}_${hash}`;
}
/** Native schema admission materializes optional required: []; compare its equivalent JSON meaning. */
export function schemasMatch(left: any, right: any): boolean {
  const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().flatMap(key =>
      key === 'required' && Array.isArray(value[key]) && value[key].length === 0 ? [] : [[key, key === 'required' && Array.isArray(value[key]) ? [...value[key]].sort() : canonical(value[key])]]));
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export function optionalStatus(settings: Settings) {
  const supported: Record<string, { path: string; args: string[] }> = {
    gdtoolkit: { path: settings.gdtoolkitExecutable, args: ['--version'] },
    imagemagick: { path: settings.imagemagickExecutable, args: ['--version'] },
    ffmpeg: { path: settings.ffmpegExecutable, args: ['-version'] },
  };
  return Object.fromEntries(OPTIONAL_IDS.map(id => {
    const selected = supported[id];
    const detected = selected ? probe(selected.path, selected.args) : { ready: false, version: '', reason: 'Candidate only; no adapter configured in this release.' };
    const allowed = settings.allowedOptionalTools.includes(id);
    return [id, { ...detected, allowed, status: !allowed ? 'DISABLED' : detected.ready ? 'READY' : 'UNAVAILABLE' }];
  }));
}
export function mapProductSettings(value: any): Partial<Settings> {
  return { enabled: value.enabled, projectRoot: value.projectRoot ?? '', godotExecutable: value.godotExecutable ?? '', bridgeMode: value.bridge.mode, bridgeExecutable: value.bridge.executable ?? '', bridgeEndpoint: value.bridge.endpoint ?? '', bridgeUrl: value.bridge.bridgeUrl ?? DEFAULTS.bridgeUrl, bridgeSecretRef: value.bridge.bridgeSecretRef ?? '', httpSecretRef: value.bridge.httpSecretRef ?? '', allowedOptionalTools: value.allowedOptionalTools, testFrameworkPreference: value.testFrameworkPreference };
}
/** Prevent unbounded held input without changing any upstream schema or result. */
export function inputRefusal(rawName: string, args: any): string | undefined {
  if (['godot_testing_run_test_scenario', 'godot_testing_run_stress_test'].includes(rawName)) return 'This aggregate can generate unpaired held input; use explicit paired input sequences and assertions.';
  if (!rawName.startsWith('godot_input_') || rawName.startsWith('godot_input_map_')) return;
  if (['godot_input_get_stats', 'godot_input_record', 'godot_input_stop_recording'].includes(rawName)) return;
  if (rawName === 'godot_input_simulate_key' || rawName === 'godot_input_simulate_action') return args?.pressed === false ? undefined : 'Use a bounded input sequence with matching release events; standalone held presses are refused.';
  if (rawName === 'godot_input_simulate_mouse') return !args?.button || args.pressed === false ? undefined : 'Mouse button presses require a matching release in a bounded sequence.';
  if (rawName !== 'godot_input_play_sequence') return 'Unreviewed input tool refused.';
  const events = args?.events; const delay = args?.delay_ms ?? 0;
  if (!Array.isArray(events) || !events.length || events.length > 128 || !Number.isInteger(delay) || delay < 0 || events.length * delay >= 5000) return 'Input sequences require 1–128 events and a total nominal delay below 5 seconds.';
  const held = new Set<string>();
  for (const event of events) {
    if (!event || typeof event !== 'object' || !['key', 'action', 'mouse'].includes(event.type)) return 'Unknown input event type refused.';
    if (event.pressed !== undefined && typeof event.pressed !== 'boolean') return 'Input pressed must be boolean.';
    let id: string;
    if (event.type === 'key') {
      if (typeof event.key !== 'string' || !event.key) return 'Key identity is required.';
      for (const modifier of ['shift', 'ctrl', 'alt', 'meta']) if (event[modifier] !== undefined && typeof event[modifier] !== 'boolean') return 'Key modifiers must be boolean.';
      id = JSON.stringify(['key', event.key, !!event.shift, !!event.ctrl, !!event.alt, !!event.meta]);
    } else if (event.type === 'action') {
      if (typeof event.action !== 'string' || !event.action || (event.strength !== undefined && (!Number.isFinite(event.strength) || event.strength < 0 || event.strength > 1))) return 'Action identity and finite strength are required.';
      id = `action:${event.action}`;
    } else {
      for (const coordinate of ['x', 'y', 'relative_x', 'relative_y']) if (event[coordinate] !== undefined && !Number.isFinite(event[coordinate])) return 'Mouse coordinates must be finite.';
      if (!event.button) continue;
      if (!['left', 'right', 'middle', 'wheel_up', 'wheel_down'].includes(event.button)) return 'Unknown mouse button refused.';
      id = `mouse:${event.button}`;
    }
    if (event.pressed === false) held.delete(id); else held.add(id);
  }
  if (held.size) return 'Every held key, action and mouse button needs a matching release in the same sequence.';
}
