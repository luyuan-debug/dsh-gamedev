import z from '@deepseek-ai/schemastery';
import * as MCP from '@deepseek-ai/dsh-mcp-client';
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { ownerFor, BUILD_INFO } from 'dsh-gamedev';
import { SERVER_NAME, VERSION, fingerprint, loopback, project, publicToolName, inputRefusal, schemasMatch, type Settings } from './config.js';
import { NativeLease, type Lease } from './lifecycle.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

export const name = 'gamedev-session';
export const inject = ['tools', 'systemPrompt', 'workingDirectory', 'agents'];
export const Config = z.object({ definitionInstance: z.string().required() });
const namespace = `mcp__${SERVER_NAME}__`;
const inventory = JSON.parse(readFileSync(new URL('../catalog/pinned-bridge-tools.json', import.meta.url), 'utf8'));
const pinned = new Map<string, any>(inventory.tools.map((tool: any) => [publicToolName(tool.name), tool]));
const opaque = new Set(['godot_composite_run_commands', 'godot_debugger_evaluate_expression']);
export async function portFree(url: string) {
  const parsed = loopback(url, true);
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('Bridge port is occupied. No process was stopped.')));
    server.listen({ host: parsed.hostname === '[::1]' ? '::1' : parsed.hostname, port: Number(parsed.port), exclusive: true }, () => server.close(() => resolve()));
  });
}
export function apply(ctx: any, config: { definitionInstance: string }) {
  const owner = ownerFor(ctx.root, config.definitionInstance);
  if (!owner) {
    ctx.tools.guard((exec: any) => exec.name.startsWith(namespace) ? 'This Godot preset definition was retired. Start a new session using the enabled current preset.' : undefined);
    return;
  }
  const generation = scopeOf(ctx);
  const bindings = new WeakMap<object, Settings>();
  const calls = new WeakMap<object, Lease<any, Settings>>();
  const busy = new WeakSet<object>();
  const reservedInput = new WeakMap<object, number>();
  const inGeneration = (agent: any) => !!agent?.ctx && scopeParentOf(scopeOf(agent.ctx)) === generation;
  const eligible = (agent: any) => owner.current() && inGeneration(agent) && ctx.agents.get(agent.id) === agent;
  const compatible = (agent: any, settings: Settings) => !bindings.has(agent) || fingerprint(bindings.get(agent)!) === fingerprint(settings);
  const lifecycle = new NativeLease<any, Settings>({
    enabled: () => owner.current() && owner.read().enabled, eligible, compatible,
    sameSettings: (left, right) => fingerprint(left) === fingerprint(right),
    settings: () => ({ ...owner.read(), allowedOptionalTools: [...owner.read().allowedOptionalTools] }),
    priorStop: owner.previousStop,
    state(phase, detail, lease) {
      if (!owner.current()) return;
      owner.state = { ...owner.state, status: phase, reason: detail, ownerSession: lease?.agent.id ?? '',
        appliedGeneration: lease ? BUILD_INFO.sourceFingerprint.slice(0,12)+':'+fingerprint(lease.settings) : '', appliedProject: lease?.settings.projectRoot ?? '',
        ...(phase === 'STARTING' ? { lastHealthAt: null, lastEditorConnected: null } : {}),
      };
      owner.refresh();
    },
    start(lease) {
      const abort = new AbortController();
      let candidate: any; let closing: Promise<void> | undefined; let candidateClosing: Promise<void> | undefined;
      const closeCandidate = () => candidateClosing ??= candidate ? Promise.resolve(candidate.dispose()).then(() => undefined) : Promise.resolve();
      const revoked = () => abort.signal.aborted || !eligible(lease.agent) || !owner.read().enabled || fingerprint(owner.read()) !== fingerprint(lease.settings);
      const ready = (async () => {
        const binding = lease.settings;
        const cwd = await ctx.workingDirectory.ensure(lease.agent, abort.signal);
        if (revoked()) throw new Error('Bridge activation was revoked.');
        if (project(cwd) !== binding.projectRoot) throw new Error('Session workspace differs from the configured Godot project. Select that workspace or open a new session.');
        bindings.set(lease.agent, binding);
        if ([...ctx.tools.view(lease.agent).visible.keys()].some((tool: any) => !tool.startsWith(namespace) && tool.endsWith('__godot_health_check'))) throw new Error('Another Godot MCP is already visible. Disconnect it before using this preset.');
        if (binding.bridgeMode !== 'stdio') throw new Error('Existing HTTP is unavailable until the native SDK supports redirect confinement.');
        if (!process.env[binding.bridgeSecretRef]) throw new Error('Bridge token environment reference is unavailable. Launch the prepared isolated environment.');
        await portFree(binding.bridgeUrl);
        if (revoked()) throw new Error('Bridge activation was revoked.');
        candidate = ctx.plugin(MCP, {
          transport: 'stdio', serverName: SERVER_NAME, command: binding.bridgeExecutable,
          args: ['-I', '-B', fileURLToPath(new URL('../bridge/guarded_main.py', import.meta.url))], cwd: binding.projectRoot,
          env: {
            GODOT_MCP_BRIDGE_URL: binding.bridgeUrl, GODOT_MCP_BRIDGE_TOKEN: process.env[binding.bridgeSecretRef],
            DSH_GAMEDEV_PROJECT_ROOT: binding.projectRoot, GODOT_MCP_PROJECT_DIR: binding.projectRoot,
            GODOT_MCP_GODOT_BIN: binding.godotExecutable, GODOT_MCP_DEFAULT_TOOLSETS: 'inspection', GODOT_MCP_CHECK_UPDATES: 'false',
            FASTMCP_CHECK_FOR_UPDATES: 'off', FASTMCP_SHOW_SERVER_BANNER: 'false',
          }, failOnStartupError: true,
          // Native transport/schema recovery never retries a caller's write.
          reconnect: { enabled: true, initialDelayMs: 300, maxDelayMs: 3000, maxAttempts: 3 },
        });
        if (revoked()) { await closeCandidate(); throw new Error('Bridge activation was revoked.'); }
        await candidate.await();
        if (revoked()) throw new Error('Bridge activation was revoked while connecting.');
      })();
      return { ready, dispose() {
        return closing ??= (async () => {
          abort.abort(new Error('Godot connection revoked.'));
          await Promise.resolve();
          if (candidate) await closeCandidate();
          // A late ensure/port check cannot create a process after abort. Do not wait on uncooperative caller UI.
          void ready.catch(() => {});
        })();
      } };
    },
  });
  owner.runtime = lifecycle;
  const reason = (exec: any): string | undefined => {
    if (!exec.name.startsWith(namespace)) return;
    if (!owner.current()) return 'This Godot preset definition was unloaded. Start a new session using the enabled current preset.';
    const settings = owner.read();
    if (!settings.enabled) return 'Godot bridge disabled in Settings.';
    if (!inGeneration(exec.agent)) return 'This session belongs to an earlier Godot preset definition. Open a new Godot 2D session.';
    if (!compatible(exec.agent, settings)) return 'Godot binding changed. This session retains its original target; open a new session for the saved project.';
    if (!lifecycle.owns(exec.agent)) return 'This bridge has one owning session, or is still starting/stopping. Wait for cleanup and use the owning session.';
    const tool = pinned.get(exec.name);
    if (!tool) return 'Unreviewed upstream tool refused; pin and review its schema before using it.';
    if (!schemasMatch(ctx.tools.get(exec.name, exec.agent)?.parameters, tool.parameters)) return 'Upstream tool schema differs from the pinned reviewed contract.';
    const inputDenied = inputRefusal(tool.name, exec.arguments); if (inputDenied) return inputDenied;
    const lease = lifecycle.lease!;
    if (tool.name === 'godot_input_play_sequence' && Date.now() < (reservedInput.get(lease) ?? 0)) return 'Wait for the previous bounded input sequence before starting another.';
    if (busy.has(lease)) return 'Another Godot call is in progress; use one serial editor channel.';
  };
  ctx.tools.guard(reason);
  ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    const gate = await next();
    if (gate.kind !== 'allow' || !exec.name.startsWith(namespace)) return gate;
    const tool = pinned.get(exec.name);
    if (tool?.meta?.safety_class !== 'read_only' && (tool?.meta?.safety_class === 'destructive' || tool?.tags.includes('export') || tool?.tags.includes('asset_import') || opaque.has(tool?.name))) return { kind: 'ask', reason: 'This Godot operation can delete data, run opaque commands, import external files or export outside the project. confirm=true is not approval.' };
    return gate;
  });
  ctx.on('tools/execute', async (exec: any, next: any) => {
    if (!exec.name.startsWith(namespace)) return next();
    const denial = reason(exec); if (denial) throw new Error(denial);
    const lease = lifecycle.lease!;
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
    const after = reason(exec); if (after || lifecycle.lease !== lease) throw new Error(after || 'Godot connection changed before dispatch.');
    if (project(cwd) !== lease.settings.projectRoot || project(ctx.workingDirectory.get(exec.agent.session)) !== lease.settings.projectRoot) throw new Error('Session workspace does not match its locked Godot target.');
    if (pinned.get(exec.name)?.name === 'godot_input_play_sequence') reservedInput.set(lease, Date.now() + exec.arguments.events.length * (exec.arguments.delay_ms ?? 0) + 100);
    calls.set(exec, lease); busy.add(lease);
    try { return await next(); } finally { busy.delete(lease); }
  });
  ctx.on('tools/result', (exec: any, result: any) => {
    const lease = calls.get(exec); calls.delete(exec);
    if (!lease || lease !== lifecycle.lease || !lifecycle.owns(exec.agent)) return;
    const tool = pinned.get(exec.name);
    if (result.isError) owner.state.reason = tool?.meta?.safety_class !== 'read_only'
      ? 'The last mutation failed or was canceled after dispatch. It may already have applied. Read back the project before retrying; reconnection does not replay writes.'
      : 'Last MCP call failed. Read its original error. The native client may be recovering its connection.';
    else if (tool?.name === 'godot_health_check') {
      const info = result.value?.structuredContent;
      if (info && typeof info.bridge_connected === 'boolean') {
        owner.state.lastHealthAt = new Date().toISOString(); owner.state.lastEditorConnected = info.bridge_connected;
        owner.state.reason = `Last health check ${owner.state.lastHealthAt}: editor ${info.bridge_connected ? 'connected' : 'disconnected'}. This is a timestamped observation, not continuous monitoring.`;
      }
    }
    owner.refresh();
  });
  ctx.systemPrompt.context({ name: 'gamedev:availability', order: 250, interpolate: false, text: (context: any) => {
    const settings = owner.read();
    const ready = JSON.parse(settings.health || '{}').optionalTools ?? {};
    const paths: any = { gdtoolkit: settings.gdtoolkitExecutable, imagemagick: settings.imagemagickExecutable, ffmpeg: settings.ffmpegExecutable };
    const lines = Object.entries(ready).filter(([id, tool]: any) => settings.allowedOptionalTools.includes(id) && tool.status === 'READY').map(([id, tool]: any) => `${id}: ${tool.version}, executable ${JSON.stringify(paths[id])}`);
    const ownership = !owner.current() ? 'This preset definition is retired; start a new session.' : context.agent && !compatible(context.agent, settings) ? 'This session retains an earlier target. Open a new session for the saved project.' : owner.state.reason;
    return `Godot 2D plugin ${VERSION}, definition ${BUILD_INFO.sourceFingerprint.slice(0,12)}; bridge ${inventory.version}. ${settings.enabled ? owner.state.status : 'DISABLED'}. ${ownership}\nConfigured project: ${JSON.stringify(settings.projectRoot)}. Configured Godot executable: ${JSON.stringify(settings.godotExecutable)}.\n${lines.length ? 'Allowed and ready CLI: '+lines.join('; ') : 'No optional CLI is both allowed and ready.'}\nCLI switches are usage policy, not a shell sandbox. One exact session and target own the bridge. Disabling releases only its owned bridge. Native reconnection does not replay writes. Read back after uncertain mutations. HTTP remains unavailable; do not install or upgrade tools.`;
  } });
  ctx.on('agent/created', ({ agent }: any) => lifecycle.request(agent));
  ctx.on('agent-preset/selected', (sessionId: string, preset: string) => {
    if (preset !== 'godot-2d') { const agent = lifecycle.preferred; if (agent?.id === sessionId) return lifecycle.released(agent); return; }
    const agent = ctx.agents.get(sessionId);
    if (agent && inGeneration(agent)) return lifecycle.request(agent);
  }, { global: true });
  ctx.on('agent/disposed', ({ agent }: any) => lifecycle.released(agent), { global: true });
  ctx.effect(() => () => lifecycle.shutdown());
}
