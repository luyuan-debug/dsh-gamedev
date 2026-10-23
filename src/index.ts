import z from '@deepseek-ai/schemastery';
import { updateVolatile } from '@deepseek-ai/cosmokit';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, OPTIONAL_IDS, PRESET_ID, SERVER_NAME, VERSION, fingerprint, optionalStatus, validateSettings, type Settings } from './config.js';

export const name = 'gamedev-settings';
export const inject = ['agentPresets', 'settings'];
export const BUILD_INFO = JSON.parse(readFileSync(new URL('./build-info.json', import.meta.url), 'utf8'));
const fields = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key,
  key === 'enabled' ? z.boolean().default(false) : key === 'allowedOptionalTools' ? z.array(z.union(OPTIONAL_IDS.map(x => z.const(x)))).default([]) : z.string().default(value as string),
]));
// Keep the browser schema structural: native clients cannot execute serialized transforms.
// Standard Schema's host validator performs semantic checks before the native atomic write.
export const Config = z.object(fields).volatile();
const structural = Config['~standard'];
Object.defineProperty(Config, '~standard', { value: { ...structural, validate(value: any) {
  try { return structural.validate(validateSettings(value)); }
  catch (error: any) { return { issues: [{ message: error.message }] }; }
} } });
type Runtime = { changed(): Promise<void>; shutdown(): Promise<void> };
type Slot = { current?: Controller; retired: Promise<void> };
const registryKey = Symbol.for('dsh-gamedev.runtime-owners.v2');
const processRegistry: WeakMap<object, Slot> = (globalThis as any)[registryKey] ??= new WeakMap();
function slotFor(root: object) {
  let slot = processRegistry.get(root);
  if (!slot) processRegistry.set(root, slot = { retired: Promise.resolve() });
  return slot;
}
export class Controller {
  readonly instance = randomUUID();
  readonly previousStop: Promise<void>;
  readonly slot: Slot;
  active = true;
  runtime?: Runtime;
  state: any = { status: 'WAITING_FOR_SESSION', reason: 'Select Godot 2D in a session using the configured project folder.', ownerSession: '', appliedGeneration: '' };
  private cache = ''; private checkedAt = 0; private optional: any = {}; private lastConfig = ''; private retirement?: Promise<void>;
  constructor(readonly ctx: any, readonly config: any) {
    this.slot = slotFor(ctx.root);
    const prior = this.slot.current;
    const stopped = prior?.retire() ?? Promise.resolve();
    this.previousStop = Promise.all([this.slot.retired, stopped]).then(() => undefined);
    this.slot.retired = this.previousStop;
    this.slot.current = this;
  }
  current() { return this.active && this.slot.current === this; }
  read(): Settings { return this.config.get(); }
  retire() {
    if (this.retirement) return this.retirement;
    this.active = false;
    this.retirement = this.runtime?.shutdown() ?? Promise.resolve();
    return this.retirement;
  }
  sync() {
    if (!this.current()) return;
    const { health, ...settings } = this.read();
    const next = JSON.stringify(settings);
    if (next !== this.lastConfig) { this.lastConfig = next; void this.runtime?.changed(); }
    this.refresh();
  }
  refresh() {
    if (!this.current()) return;
    const settings = this.read();
    const key = JSON.stringify([settings.allowedOptionalTools, settings.gdtoolkitExecutable, settings.imagemagickExecutable, settings.ffmpegExecutable]);
    if (key !== this.cache || Date.now() - this.checkedAt > 60000) { this.optional = optionalStatus(settings); this.cache = key; this.checkedAt = Date.now(); }
    const status = !settings.enabled && this.state.status !== 'STOPPING' ? 'DISABLED' : this.state.status;
    const health = JSON.stringify({ ...this.state, status, definitionInstance: this.instance, version: VERSION+' ('+BUILD_INFO.sourceFingerprint.slice(0,12)+')', definitionFingerprint: BUILD_INFO.sourceFingerprint, projectRoot: settings.projectRoot, savedGeneration: BUILD_INFO.sourceFingerprint.slice(0,12)+':'+fingerprint(settings), godotVersion: settings.enabled ? '4.7.2 stable (validated when saved)' : 'Not probed', bridgeVersion: '2026.10.20.1', optionalCheckedAt: new Date(this.checkedAt).toISOString(), optionalTools: this.optional });
    if (settings.health !== health) {
      updateVolatile(this.config, { get: () => ({ ...settings, health }) });
      const descriptor = this.ctx.settings.describe().find((form: any) => form.ns === 'gamedev-settings');
      if (descriptor) this.ctx.emit('settings/document-updated', 'gamedev-settings', descriptor.revision);
    }
  }
}
export function ownerFor(root: object, instance?: string): Controller | undefined {
  const owner = slotFor(root).current;
  return owner?.current() && (!instance || owner.instance === instance) ? owner : undefined;
}
function row(id: string, suffix: string, config?: any) { return { id, name: `@deepseek-ai/dsh-${suffix}`, ...(config ? { config } : {}) }; }
export function presetDefinition(instance: string) {
  const prefix = readFileSync(new URL('../prompts/godot-2d.md', import.meta.url), 'utf8');
  const skills = fileURLToPath(new URL('../skills', import.meta.url));
  return { id: PRESET_ID, name: 'Godot 2D', description: '编写游戏脚本、修改场景、运行与调试 · Godot 4.7.2', order: 20, plugins: [
    row('persona', 'persona', { prefix }), row('agent-instructions', 'agent-instructions', { maxBytes: 65536 }),
    row('time-context', 'time-context'), row('tool-shell', process.platform === 'win32' ? 'tool-pwsh' : 'tool-bash'),
    row('tool-fs', 'tool-fs'), row('tool-fs-search', 'tool-fs-search', { sampleOverCapGlobResults: false }), row('tool-jobs', 'tool-jobs'),
    row('skill-filesystem', 'skill-filesystem', { customSkillDirs: [skills] }), row('tool-skill', 'tool-skill'),
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true, toolResultPruner: true }, config: [row('compaction-basic', 'compaction-basic'), row('command-compact', 'command-compact'), row('tool-result-pruner', 'compaction-tool-result-pruner', { thresholdChars: 8192, headChars: 4096, tailChars: 1024 })] },
    row('tool-ask-user', 'tool-ask-user'), row('tool-web', 'tool-web', { fetch: true, searchTimeoutMs: 60000 }), row('present', 'tool-present'),
    { id: 'gamedev-session', name: 'dsh-gamedev/session', config: { definitionInstance: instance } },
  ] };
}
export async function apply(ctx: any, config: any) {
  const controller = new Controller(ctx, config);
  ctx.effect(() => () => controller.retire());
  ctx.inject(['settings'], (child: any) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)));
  const unregister = await ctx.agentPresets.register(presetDefinition(controller.instance));
  ctx.effect(() => unregister);
  ctx.on('settings/document-updated', (ns: string) => { if (ns === 'gamedev-settings') controller.sync(); }, { global: true });
  controller.sync();
  ctx.effect(() => { const timer = setInterval(() => controller.sync(), 250); timer.unref(); return () => clearInterval(timer); });
}
