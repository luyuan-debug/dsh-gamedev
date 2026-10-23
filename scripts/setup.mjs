#!/usr/bin/env node
/** Explicit local installer. Never imported by a DSH plugin or registered as a model tool. */
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import net from 'node:net';
import * as http from 'node:http';

export const PINS = Object.freeze({ dsh: '0.2.1-rc.2', engine: '4.7.2', bridge: '2026.10.20.1' });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = '.dsh-gamedev-owner.json';
const PROFILE = 'gamedev-isolated';
const TOKEN_REF = 'DSH_GAMEDEV_BRIDGE_TOKEN';
const PY_IMPORT = 'import importlib.metadata,mcp_server,fastmcp;print(importlib.metadata.version("godot-editor-mcp")+"|"+mcp_server.__version__)';
const LAYOUT = ['dsh-home', 'agents-home', 'deps', 'state', 'logs', 'project', 'cache', 'config', 'pnpm-state', 'pnpm-home'];
const sha = data => createHash('sha256').update(data).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const inside = (root, candidate) => candidate !== root && path.relative(root, candidate) !== '..' && !path.relative(root, candidate).startsWith('..' + path.sep) && !path.isAbsolute(path.relative(root, candidate));
const exists = async file => { try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

export function parseArgs(argv) {
  const first = argv.shift();
  const command = first === '--help' || first === '-h' ? 'help' : first ?? 'help';
  const values = {};
  const flags = new Set(['offline', 'allow-download', 'no-open', 'json', 'help']);
  const fields = new Set(['workspace', 'dsh', 'godot', 'python', 'dotnet', 'package', 'package-sha256', 'find-links', 'port', 'bridge-port']);
  while (argv.length) {
    const key = argv.shift();
    if (!key.startsWith('--') || values[key.slice(2)] !== undefined) throw new Error('Invalid or repeated option: ' + key);
    const name = key.slice(2);
    if (flags.has(name)) values[name] = true;
    else if (fields.has(name) && argv.length && !argv[0].startsWith('--')) values[name] = argv.shift();
    else throw new Error('Unknown or missing option: ' + key);
  }
  return { command, options: values };
}
export function scrub(text, secrets = []) {
  let value = String(text);
  for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
  return value.replace(/([?&#]token=)[^&\s"'<>]+/gi, '$1[REDACTED]');
}
export function streamScrubber(emit, secrets = []) {
  let tail = ''; let dropping = false;
  return {
    write(chunk) {
      tail += chunk.toString('utf8');
      let end;
      while ((end = tail.indexOf('\n')) !== -1) {
        const line = tail.slice(0, end + 1); tail = tail.slice(end + 1);
        if (dropping) { emit('[Oversized output line omitted]\n'); dropping = false; }
        else emit(scrub(line, secrets));
      }
      if (tail.length > 65536) { tail = ''; dropping = true; }
    },
    end() { if (dropping) emit('[Oversized output line omitted]\n'); else if (tail) emit(scrub(tail, secrets)); tail = ''; dropping = false; },
  };
}
export function isolatedEnv(workspace, dsh, additions = {}, dotnet) {
  // HOME is retained: it must never be repointed to disguise runtime user:// paths.
  // Arbitrary API keys, NODE_OPTIONS, PYTHONPATH and npm/pip configuration are not inherited.
  const runtime = path.resolve(path.dirname(dsh), '../..');
  return {
    PATH: [path.join(runtime, 'bin'), path.join(runtime, 'primary-runtime/dependencies/node/bin'), ...(dotnet ? [path.dirname(dotnet.executable)] : []), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter),
    ...(dotnet ? {
      DOTNET_ROOT: dotnet.root, DOTNET_CLI_HOME: path.join(workspace, 'state/dotnet-home'),
      NUGET_PACKAGES: path.join(workspace, 'deps/nuget-packages'), NUGET_HTTP_CACHE_PATH: path.join(workspace, 'cache/nuget-http'),
      MSBuildUserExtensionsPath: path.join(workspace, 'state/msbuild'),
      DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}), LANG: 'en_US.UTF-8', NO_COLOR: '1',
    DSH_HOME: path.join(workspace, 'dsh-home'), DSH_AGENTS_HOME: path.join(workspace, 'agents-home'), DSH_TOOLS_MODE: 'native',
    XDG_CACHE_HOME: path.join(workspace, 'cache'), XDG_CONFIG_HOME: path.join(workspace, 'config'), XDG_STATE_HOME: path.join(workspace, 'pnpm-state'),
    NPM_CONFIG_CACHE: path.join(workspace, 'cache/npm'), NPM_CONFIG_USERCONFIG: path.join(workspace, 'config/empty-user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(workspace, 'config/empty-global.npmrc'), PNPM_HOME: path.join(workspace, 'pnpm-home'),
    PIP_CONFIG_FILE: '/dev/null', PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONDONTWRITEBYTECODE: '1',
    FASTMCP_CHECK_FOR_UPDATES: 'off', FASTMCP_SHOW_SERVER_BANNER: 'false', ...additions,
  };
}
function ownedEnv(manifest, additions = {}) {
  const { paths, dotnetRoot } = manifest.tools;
  return isolatedEnv(manifest.workspace, paths.dsh, additions, paths.dotnet ? { executable: paths.dotnet, root: dotnetRoot } : undefined);
}
export async function run(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let timer; let killTimer; let overflow = false;
    const collect = data => { size += data.length; if (size > 4 * 1024 * 1024) { overflow = true; child.kill('SIGTERM'); } else chunks.push(data); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(new Error('Cannot execute ' + program + ': ' + error.code)); });
    timer = setTimeout(() => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref(); }, options.timeout ?? 120_000);
    timer.unref();
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      const output = scrub(Buffer.concat(chunks).toString('utf8'), options.secrets);
      if (code === 0 && !overflow) resolve({ output, code });
      else reject(Object.assign(new Error('Command failed (' + (code ?? signal) + '): ' + program + '\n' + output.slice(-12_000)), { code, output }));
    });
  });
}
export async function absoluteExecutable(input, label) {
  if (!input || !path.isAbsolute(input)) throw new Error(label + ' must be an existing absolute executable path.');
  const actual = await fs.realpath(input); const stat = await fs.stat(actual);
  if (!stat.isFile()) throw new Error(label + ' is not a file.');
  await fs.access(actual, constants.X_OK);
  // Keep the invocation path: resolving a venv Python loses its site-packages.
  return path.resolve(input);
}
export async function newWorkspace(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('--workspace must be an absolute, new directory.');
  const parent = await fs.realpath(path.dirname(input));
  const target = path.join(parent, path.basename(input));
  if (target === parent || await exists(target)) throw new Error('Workspace already exists. Refusing to reuse or overwrite any directory.');
  return target;
}
export async function readOwner(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('--workspace must be an absolute owned workspace.');
  const workspace = await fs.realpath(input);
  const marker = path.join(workspace, OWNER); const stat = await fs.lstat(marker);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ownership marker must be a regular file.');
  const manifest = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.product !== 'dsh-gamedev-setup' || manifest.workspace !== workspace || !/^[0-9a-f-]{36}$/.test(manifest.id)) throw new Error('Invalid workspace ownership marker; no changes made.');
  for (const relative of LAYOUT) {
    const candidate = path.join(workspace, relative);
    if (!inside(workspace, candidate) || (await exists(candidate) && (await fs.lstat(candidate)).isSymbolicLink())) throw new Error('Owned directory was replaced by a symlink: ' + relative);
  }
  const profile = path.join(workspace, 'dsh-home/profiles', PROFILE);
  if (await exists(profile)) {
    const real = await fs.realpath(profile);
    if (!inside(workspace, real) || real !== profile) throw new Error('Profile directory is linked or outside this workspace.');
    for (const file of ['cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']) {
      const target = path.join(profile, file);
      if (await exists(target) && (await fs.lstat(target)).isSymbolicLink()) throw new Error('Owned profile file was replaced by a symlink: ' + file);
    }
  }
  return manifest;
}
async function writeOwner(manifest) {
  const target = path.join(manifest.workspace, OWNER); const temp = target + '.next';
  await fs.writeFile(temp, json(manifest), { mode: 0o600, flag: 'wx' });
  await fs.rename(temp, target);
}
export function tarMembers(compressed) {
  const data = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  const files = new Map(); let offset = 0;
  while (offset + 512 <= data.length) {
    const h = data.subarray(offset, offset + 512); offset += 512;
    if (h.every(x => x === 0)) break;
    const string = (start, count) => h.subarray(start, start + count).toString('utf8').split('\0')[0];
    const name = (string(345, 155) ? string(345, 155) + '/' : '') + string(0, 100);
    const sizeText = string(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Unsupported tar size encoding.');
    const size = Number.parseInt(sizeText, 8); const type = String.fromCharCode(h[156] || 48);
    if (!name.startsWith('package/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.') || path.posix.isAbsolute(name)) throw new Error('Unsafe tarball member: ' + name);
    if (!['0', '5'].includes(type) || size > 25 * 1024 * 1024 || offset + size > data.length) throw new Error('Only bounded regular package files/directories are accepted.');
    if (type === '0') {
      const relative = name.slice(8);
      if (!relative || files.has(relative)) throw new Error('Duplicate or empty package member.');
      files.set(relative, data.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  if (!files.has('package.json')) throw new Error('Package manifest missing.');
  const pkg = JSON.parse(files.get('package.json').toString('utf8'));
  if (pkg.name !== 'dsh-gamedev' || pkg.engines?.dsh !== PINS.dsh || !files.has('bridge/guarded_main.py') || !files.has('dist/index.js')) throw new Error('Not a compatible built dsh-gamedev package.');
  if (['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'].some(key => pkg.scripts?.[key])) throw new Error('Unexpected package lifecycle script; refusing installer execution.');
  return { files, package: pkg };
}
export async function verifyPackage(file, expected) {
  if (!file || !path.isAbsolute(file) || !/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('--package requires an absolute tgz path and --package-sha256 requires its independent 64-character digest.');
  const content = await fs.readFile(file);
  if (sha(content) !== expected) throw new Error('Plugin package SHA256 mismatch. No install attempted.');
  return { ...tarMembers(content), content, sha256: expected };
}
function portOption(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use an unprivileged port in 1024..65535.');
  return port;
}
export async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref();
    server.once('error', () => reject(new Error('Loopback port ' + port + ' is occupied. Nothing was stopped.')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}
export async function probeTools(options, invoke = run) {
  if (typeof http.setGlobalProxyFromEnv !== 'function') throw new Error('Setup requires Node 24.14+ (or 25.4+); select an existing supported Node without upgrading daily software.');
  const paths = { dsh: await absoluteExecutable(options.dsh, 'DSH'), godot: await absoluteExecutable(options.godot, 'Godot'), python: await absoluteExecutable(options.python, 'Python') };
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1', FASTMCP_CHECK_FOR_UPDATES: 'off' };
  const results = await Promise.allSettled([
    invoke(paths.dsh, ['--version'], { env, timeout: 15_000 }),
    invoke(paths.godot, ['--version'], { env, timeout: 10_000 }),
    invoke(paths.python, ['-I', '-B', '-c', 'import sys,platform,json;print(json.dumps({"version":list(sys.version_info[:3]),"system":platform.system(),"machine":platform.machine(),"implementation":sys.implementation.name}))'], { env, timeout: 10_000 }),
  ]);
  for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') throw new Error(Object.keys(paths)[i] + ' probe failed: ' + results[i].reason.message);
  const versions = { dsh: results[0].value.output.trim(), godot: results[1].value.output.trim(), python: JSON.parse(results[2].value.output.trim()) };
  if (!versions.dsh.split(/\s+/).includes(PINS.dsh)) throw new Error('DSH ' + PINS.dsh + ' is required; found ' + versions.dsh);
  if (!/^4\.7\.2\.stable(?:\.|$)/.test(versions.godot)) throw new Error('Godot 4.7.2 stable is required; found ' + versions.godot);
  if (versions.python.system !== 'Darwin' || versions.python.machine !== 'arm64' || versions.python.implementation !== 'cpython' || versions.python.version[0] !== 3 || versions.python.version[1] !== 14) throw new Error('This dependency wheel ledger supports macOS arm64 CPython 3.14. Select that existing Python; no interpreter is downloaded.');
  const mono = versions.godot.split('.').includes('mono');
  if (mono && !options.dotnet) throw new Error('Mono Godot requires an explicit --dotnet /absolute/path/to/dotnet. A --version check does not prove its game runtime can initialize. Select an existing .NET SDK; nothing is downloaded or upgraded.');
  let dotnetRoot;
  if (options.dotnet) {
    paths.dotnet = await absoluteExecutable(options.dotnet, '.NET');
    const sdkEnv = { ...env, DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
    const result = await invoke(paths.dotnet, ['--version'], { env: sdkEnv, timeout: 10_000 });
    versions.dotnet = result.output.trim();
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versions.dotnet)) throw new Error('The selected .NET executable did not report a valid SDK version.');
    // Homebrew may expose a shell launcher in bin/, rather than the real libexec
    // host. Ask only this selected executable for its installed Core runtime root.
    const runtimes = await invoke(paths.dotnet, ['--list-runtimes'], { env: sdkEnv, timeout: 10_000 });
    const roots = new Set();
    for (const line of runtimes.output.split(/\r?\n/)) {
      const match = /^Microsoft\.NETCore\.App\s+\S+\s+\[(.+)\]$/.exec(line.trim());
      if (match && path.isAbsolute(match[1]) && path.basename(match[1]) === 'Microsoft.NETCore.App' && path.basename(path.dirname(match[1])) === 'shared') roots.add(await fs.realpath(path.dirname(path.dirname(match[1]))));
    }
    if (roots.size !== 1) throw new Error('The selected .NET executable did not report one unambiguous installed Microsoft.NETCore.App runtime root.');
    dotnetRoot = [...roots][0];
    await absoluteExecutable(path.join(dotnetRoot, 'dotnet'), '.NET runtime host');
    if (!(await fs.stat(path.join(dotnetRoot, 'host/fxr'))).isDirectory()) throw new Error('The selected .NET runtime root has no host/fxr directory.');
  }
  return { paths, versions, ...(dotnetRoot ? { dotnetRoot } : {}) };
}
export function profilePatch(manifest, enabled = true) {
  const { workspace: w } = manifest;
  const config = { enabled, projectRoot: path.join(w, 'project'), godotExecutable: manifest.godotCopy, bridgeMode: 'stdio', bridgeExecutable: path.join(w, 'deps/bridge-venv/bin/python'), bridgeUrl: 'ws://127.0.0.1:' + manifest.bridgePort, bridgeSecretRef: TOKEN_REF, bridgeEndpoint: '', httpSecretRef: '', allowedOptionalTools: [], gdtoolkitExecutable: '', imagemagickExecutable: '', ffmpegExecutable: '', testFrameworkPreference: 'existing' };
  return '- id: web-runtime\n  config: {openBrowser: true, printUrl: false}\n' +
    '- id: sandbox-policy\n  config: ' + JSON.stringify({ mode: 'workspace-write', workspaceRoot: config.projectRoot }) + '\n' +
    '- id: approval\n  config: {policy: ask}\n' +
    '- id: gamedev-settings\n  name: dsh-gamedev\n  config: ' + JSON.stringify(config) + '\n';
}
export async function downloadArtifact(artifact, downloads, source, online, request = fetch) {
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || path.basename(artifact.filename) !== artifact.filename) throw new Error('Invalid pinned artifact metadata.');
  const target = path.join(downloads, artifact.filename);
  const supplied = source && path.join(source, artifact.filename);
  if (supplied && await exists(supplied)) {
    const bytes = await fs.readFile(supplied);
    if (sha(bytes) !== artifact.sha256) throw new Error('Local artifact SHA256 mismatch: ' + artifact.filename);
    await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); return target;
  }
  if (!online) throw new Error('Offline artifact missing: ' + artifact.filename + '. Supply --find-links with the locked wheels and addon zip.');
  const url = new URL(artifact.url);
  if (url.protocol !== 'https:' || !['github.com', 'files.pythonhosted.org'].includes(url.hostname)) throw new Error('Artifact source is outside the fixed upstream allowlist.');
  for (let attempt = 1; attempt <= 3; attempt++) {
    let bytes;
    try {
      const response = await request(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        if (response.status === 429 || response.status >= 500) throw error;
        throw Object.assign(error, { permanent: true });
      }
      // GitHub release assets redirect to their signed asset CDN. Verify final bytes independently.
      const final = new URL(response.url);
      if (final.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'files.pythonhosted.org'].includes(final.hostname)) throw Object.assign(new Error('Redirect outside the official release/PyPI CDN allowlist.'), { permanent: true });
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > 64 * 1024 * 1024) throw Object.assign(new Error('Pinned artifact exceeds installer size limit.'), { permanent: true });
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > 64 * 1024 * 1024) throw Object.assign(new Error('Pinned artifact exceeds installer size limit.'), { permanent: true }); chunks.push(chunk); }
      bytes = Buffer.concat(chunks);
    } catch (error) {
      if (error.permanent || attempt === 3) throw new Error('Artifact download failed: ' + artifact.filename + ' (attempt ' + attempt + '/3): ' + error.message);
      await new Promise(resolve => setTimeout(resolve, attempt * 300));
      continue;
    }
    if (sha(bytes) !== artifact.sha256) throw new Error('Downloaded artifact SHA256 mismatch: ' + artifact.filename);
    await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); return target;
  }
}
async function copyGodot(original, workspace) {
  const suffix = path.join('Contents', 'MacOS', 'Godot');
  if (!original.endsWith(path.sep + suffix)) throw new Error('Godot must be the executable inside an installed macOS .app; its Resources are required for an isolated copy.');
  const app = original.slice(0, -suffix.length - 1);
  if (!app.endsWith('.app') || (await fs.lstat(app)).isSymbolicLink()) throw new Error('Select the real installed Godot .app, rather than an app symlink.');
  const copied = path.join(workspace, 'deps/Godot.app');
  await fs.cp(app, copied, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true,
    filter: source => !['editor_data', '_sc_', '.git'].includes(path.basename(source)) });
  const binary = path.join(copied, suffix);
  if (sha(await fs.readFile(binary)) !== sha(await fs.readFile(original))) throw new Error('Copied Godot executable differs from original.');
  await fs.writeFile(path.join(path.dirname(binary), '_sc_'), '', { flag: 'wx', mode: 0o600 });
  // macOS releases can resolve self-contained mode next to the .app instead.
  await fs.writeFile(path.join(workspace, 'deps/_sc_'), '', { flag: 'wx', mode: 0o600 });
  return binary;
}
export async function verifyEditorPaths(workspace, data) {
  if (!data?.selfContained || !data.marker) throw new Error('Copied Godot did not enter self-contained mode.');
  for (const key of ['data', 'config', 'cache', 'marker']) {
    if (typeof data[key] !== 'string' || !path.isAbsolute(data[key]) || !inside(workspace, await fs.realpath(data[key]))) throw new Error('Godot editor ' + key + ' path is outside the owned workspace.');
  }
  return data;
}
export function verifyRuntimeReady(output, id, mono) {
  const lines = String(output).split(/\r?\n/).filter(line => line.startsWith('DSH_GAMEDEV_RUNTIME_READY='));
  if (lines.length !== 1) throw new Error('Godot runtime did not emit exactly one readiness marker; --version or exit zero alone is insufficient.');
  if (/^(?:SCRIPT )?ERROR:/m.test(output)) throw new Error('Godot runtime reported an error despite its readiness marker.');
  let result;
  try { result = JSON.parse(lines[0].slice('DSH_GAMEDEV_RUNTIME_READY='.length)); }
  catch { throw new Error('Godot runtime readiness marker is invalid JSON.'); }
  if (result.id !== id || !/^4\.7\.2(?:[.-])stable(?:[. -]|$)/.test(result.engine ?? '') || result.managed !== mono || !path.isAbsolute(result.userData ?? '') || path.basename(result.userData) !== 'runtime-probe-' + id) throw new Error('Godot runtime readiness identity, engine, managed state or isolated user data did not match this probe.');
  return result;
}
export async function probeRuntime(manifest, invoke = run) {
  const w = manifest.workspace;
  const id = randomUUID();
  const probeDir = await fs.mkdtemp(path.join(w, 'state/runtime-probe-'));
  const probeScript = path.join(probeDir, 'probe.gd');
  const userData = 'DSH-GameDev/runtime-probe-' + id;
  await fs.writeFile(path.join(probeDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="DSH GameDev Runtime Probe"\nconfig/use_custom_user_dir=true\nconfig/custom_user_dir_name=' + JSON.stringify(userData) + '\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n', { flag: 'wx', mode: 0o600 });
  await fs.copyFile(path.join(ROOT, 'scripts/setup/probe_runtime.gd'), probeScript, constants.COPYFILE_EXCL);
  const log = path.join(w, 'logs', 'runtime-probe-' + id + '.log');
  try {
    const result = await invoke(manifest.godotCopy, ['--headless', '--path', probeDir, '--script', probeScript, '--', '--dsh-gamedev-probe-id', id], { env: ownedEnv(manifest), cwd: probeDir, timeout: 20_000 });
    await fs.writeFile(log, result.output, { flag: 'wx', mode: 0o600 });
    const ready = verifyRuntimeReady(result.output, id, manifest.tools.versions.godot.split('.').includes('mono'));
    return { ...ready, project: path.relative(w, probeDir), log: path.relative(w, log) };
  } catch (error) {
    if (!(await exists(log))) await fs.writeFile(log, scrub(error.output ?? error.message), { flag: 'wx', mode: 0o600 });
    throw new Error('Owned Godot headless runtime readiness failed; inspect ' + path.relative(w, log) + ': ' + error.message);
  }
}
export async function prepare(options, hooks = {}) {
  const invoke = hooks.run ?? run;
  if (options.offline && options['allow-download']) throw new Error('Choose --offline or --allow-download, not both.');
  if (!options.offline && !options['allow-download']) throw new Error('Choose --offline explicitly, or --allow-download for fixed, hash-checked artifacts.');
  const workspace = await newWorkspace(options.workspace);
  const pkg = await verifyPackage(options.package, options['package-sha256']);
  const tools = await probeTools(options, invoke);
  const webPort = portOption(options.port, 53190), bridgePort = portOption(options['bridge-port'], 19090);
  if (webPort === bridgePort) throw new Error('Web and bridge ports must differ.');
  await Promise.all([assertFree(webPort), assertFree(bridgePort)]);
  const source = options['find-links'] ? await fs.realpath(options['find-links']) : null;
  if (source && !(await fs.stat(source)).isDirectory()) throw new Error('--find-links must be a local wheel/addon directory.');
  const lock = pkg.files.get('locks/bridge-requirements.lock'); const ledgerBytes = pkg.files.get('resolved-dependencies.json');
  if (!lock || !ledgerBytes) throw new Error('Package must contain its exact dependency lock and artifact ledger.');
  const ledger = JSON.parse(ledgerBytes); const artifacts = [];
  for (const item of ledger.core ?? []) artifacts.push({ filename: new URL(item.url).pathname.split('/').pop(), url: item.url, sha256: item.sha256 });
  for (const item of ledger.pythonDistributions ?? []) {
    const artifact = item.artifact;
    if (!artifact?.filename || artifact.type !== 'wheel' || !lock.toString('utf8').includes('--hash=sha256:' + artifact.sha256)) throw new Error('Dependency artifact is not a locked wheel: ' + item.name);
    artifacts.push({ filename: artifact.filename, url: artifact.url, sha256: artifact.sha256 });
  }
  const unique = [...new Map(artifacts.map(x => [x.filename, x])).values()];
  const wheel = unique.find(x => x.filename === 'godot_editor_mcp-2026.10.20.1-py3-none-any.whl');
  const addon = unique.find(x => x.filename === 'godot_mcp_addon.zip');
  if (!wheel || wheel.sha256 !== 'cb32961dd87d983a55ba94ea3357e3ebdb540f5fe9e543e41e35353fbe51b640' || !addon || addon.sha256 !== '7173bb197eca2a8522b2173342ce474052d7746c3b36a9d404e554ae8cc1fbaf') throw new Error('Core bridge/addon pins differ from supported release.');
  if (unique.length < 3) throw new Error('Dependency ledger is incomplete.');
  await fs.mkdir(workspace, { mode: 0o700 });
  const manifest = { schemaVersion: 1, product: 'dsh-gamedev-setup', id: randomUUID(), workspace, createdAt: new Date().toISOString(), state: 'PREPARING', profile: PROFILE, webPort, bridgePort, tools, package: { version: pkg.package.version, sha256: pkg.sha256 }, artifactLockSHA256: sha(lock), runtimeUserData: 'DSH-GameDev/' + path.basename(workspace) + '-' + randomBytes(4).toString('hex'), retainedOnUninstall: ['project', 'saves', 'logs', 'deps', 'dsh-home', 'agents-home'] };
  await writeOwner(manifest);
  try {
    for (const relative of LAYOUT) await fs.mkdir(path.join(workspace, relative), { mode: 0o700 });
    for (const name of ['empty-user.npmrc', 'empty-global.npmrc']) await fs.writeFile(path.join(workspace, 'config', name), '', { mode: 0o600, flag: 'wx' });
    const downloads = path.join(workspace, 'deps/downloads'); await fs.mkdir(downloads, { mode: 0o700 });
    const hashed = path.join(workspace, 'deps/dsh-gamedev-' + pkg.sha256 + '.tgz'); await fs.writeFile(hashed, pkg.content, { flag: 'wx', mode: 0o600 });
    manifest.package.path = hashed; await writeOwner(manifest);
    // This explicit setup process honors the user's existing proxy environment only for fixed downloads.
    // Do not copy proxy values into the workspace, logs or launched DSH/Godot environments.
    const restoreProxy = options['allow-download'] ? http.setGlobalProxyFromEnv() : undefined;
    try { for (const artifact of unique) await downloadArtifact(artifact, downloads, source, Boolean(options['allow-download'])); }
    finally { restoreProxy?.(); }
    manifest.godotCopy = await copyGodot(tools.paths.godot, workspace);
    manifest.godotSHA256 = sha(await fs.readFile(manifest.godotCopy));
    const env = ownedEnv(manifest);
    await fs.writeFile(path.join(workspace, 'deps/bridge-requirements.lock'), lock, { mode: 0o600, flag: 'wx' });
    const logs = async (name, program, args, extra = {}) => {
      try { const result = await invoke(program, args, { env, cwd: workspace, ...extra }); await fs.writeFile(path.join(workspace, 'logs', name + '.log'), result.output, { mode: 0o600 }); return result; }
      catch (error) { await fs.writeFile(path.join(workspace, 'logs', name + '.log'), scrub(error.output ?? error.message), { mode: 0o600 }); throw error; }
    };
    const probeDir = path.join(workspace, 'state/editor-probe'); await fs.mkdir(probeDir, { mode: 0o700 });
    await fs.writeFile(path.join(probeDir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="DSH GameDev Editor Paths"\nconfig/use_custom_user_dir=true\nconfig/custom_user_dir_name=' + JSON.stringify(manifest.runtimeUserData + '/editor-probe') + '\n', { mode: 0o600, flag: 'wx' });
    const probeScript = path.join(probeDir, 'probe.gd');
    await fs.copyFile(path.join(ROOT, 'scripts/setup/probe_editor.gd'), probeScript, constants.COPYFILE_EXCL);
    const editorProbe = await logs('probe-editor-paths', manifest.godotCopy, ['--headless', '--editor', '--path', probeDir, '--script', probeScript], { timeout: 30_000 });
    const editorLine = editorProbe.output.split('\n').find(line => line.startsWith('DSH_GAMEDEV_EDITOR_PATHS='));
    if (!editorLine) throw new Error('Godot did not report editor isolation paths; inspect logs/probe-editor-paths.log.');
    manifest.editorPaths = await verifyEditorPaths(workspace, JSON.parse(editorLine.slice('DSH_GAMEDEV_EDITOR_PATHS='.length)));
    manifest.runtimeProbe = await probeRuntime(manifest, invoke);
    await logs('create-venv', tools.paths.python, ['-I', '-B', '-m', 'venv', path.join(workspace, 'deps/bridge-venv')]);
    const python = path.join(workspace, 'deps/bridge-venv/bin/python');
    await logs('install-bridge', python, ['-I', '-B', '-m', 'pip', '--isolated', 'install', '--no-index', '--find-links', downloads, '--only-binary=:all:', '--require-hashes', '--no-deps', '-r', path.join(workspace, 'deps/bridge-requirements.lock')], { timeout: 180_000 });
    const bridge = await logs('probe-bridge', python, ['-I', '-B', '-c', PY_IMPORT]);
    if (bridge.output.trim() !== PINS.bridge + '|' + PINS.bridge) throw new Error('Bridge import probe did not match the pinned release.');
    const zipCode = await fs.readFile(path.join(ROOT, 'scripts/setup/extract_addon.py'), 'utf8');
    const extracted = await logs('extract-addon', tools.paths.python, ['-I', '-B', '-c', zipCode, path.join(downloads, addon.filename), path.join(workspace, 'project')]);
    manifest.addonFiles = JSON.parse(extracted.output);
    await fs.writeFile(path.join(workspace, 'project/project.godot'), '; Task-owned empty project. No existing game is imported or modified.\nconfig_version=5\n\n[application]\nconfig/name="DSH GameDev"\nconfig/use_custom_user_dir=true\nconfig/custom_user_dir_name=' + JSON.stringify(manifest.runtimeUserData) + '\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.mobile="gl_compatibility"\n\n[editor_plugins]\nenabled=PackedStringArray("res://addons/godot_mcp/plugin.cfg")\n', { flag: 'wx', mode: 0o600 });
    const profile = path.join(workspace, 'dsh-home/profiles', PROFILE); await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(profile, 'package.json'), json({ name: 'dsh-profile-' + PROFILE, private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }), { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(profile, 'cordis.yml'), '[]\n', { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(profile, 'pnpm-workspace.yaml'), 'autoInstallPeers: false\nstoreDir: ../../pnpm-store\ncacheDir: ' + JSON.stringify(path.join(workspace, 'cache/pnpm')) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(profile, '.npmrc'), 'auto-install-peers=false\nstore-dir=../../pnpm-store\n', { flag: 'wx', mode: 0o600 });
    await logs('install-plugin', tools.paths.dsh, ['plugin', '--profile', PROFILE, 'add', hashed], { timeout: 180_000 });
    const installed = path.join(profile, 'node_modules/dsh-gamedev');
    for (const [relative, expected] of pkg.files) {
      const target = path.join(installed, relative);
      if (!inside(installed, target) || sha(await fs.readFile(target)) !== sha(expected)) throw new Error('Installed package bytes differ: ' + relative);
    }
    manifest.installedFileCount = pkg.files.size;
    const patch = profilePatch(manifest); await fs.writeFile(path.join(profile, 'cordis.patch.yml'), patch, { mode: 0o600 });
    manifest.setupPatchSHA256 = sha(patch); manifest.state = 'READY'; await writeOwner(manifest);
    return manifest;
  } catch (error) {
    manifest.state = 'FAILED'; manifest.failure = scrub(error.message).slice(0, 12_000); await writeOwner(manifest); throw error;
  }
}
export async function doctor(options, hooks = {}) {
  const checks = []; let manifest;
  const invoke = hooks.run ?? run;
  const check = async (name, operation, required = true) => {
    try { const value = await operation(); checks.push({ name, status: 'PASS', required, detail: value }); }
    catch (error) { checks.push({ name, status: required ? 'FAIL' : 'WARN', required, detail: scrub(error.message) }); }
  };
  if (options.workspace) await check('workspace ownership', async () => { manifest = await readOwner(options.workspace); if (manifest.state !== 'READY') throw new Error('Workspace state is ' + manifest.state); return manifest.workspace; });
  const tools = manifest?.tools.paths ?? options;
  let verifiedTools;
  await check('runtime versions', async () => { verifiedTools = await probeTools(tools, invoke); if (manifest && manifest.tools.dotnetRoot !== verifiedTools.dotnetRoot) { verifiedTools = undefined; throw new Error('Selected .NET executable resolves to a different runtime root than prepare.'); } return verifiedTools; });
  if (options.package) await check('plugin package SHA256', async () => { const pkg = await verifyPackage(options.package, options['package-sha256']); return { sha256: pkg.sha256, version: pkg.package.version }; });
  if (manifest) {
    const w = manifest.workspace;
    let workspaceIdle = false; let copiedGodotReady = false;
    await check('workspace launch lock', async () => { if (await exists(path.join(w, 'state/launch.lock'))) throw new Error('An owned launch is active, or a stale lock needs manual review. Do not delete it while its host is alive.'); workspaceIdle = true; return 'idle'; });
    await check('isolated Godot executable', async () => { const actual = await fs.realpath(manifest.godotCopy); if (!inside(w, actual) || actual !== manifest.godotCopy || sha(await fs.readFile(manifest.godotCopy)) !== manifest.godotSHA256 || !(await exists(path.join(path.dirname(manifest.godotCopy), '_sc_')))) throw new Error('Godot copy or self-contained marker changed.'); copiedGodotReady = true; return 'copied binary SHA256 and _sc_ match'; });
    await check('observed editor paths', async () => verifyEditorPaths(w, manifest.editorPaths));
    await check('owned headless runtime readiness', async () => { if (!verifiedTools || manifest.state !== 'READY' || !workspaceIdle || !copiedGodotReady) throw new Error('Workspace readiness, launch lock, copied Godot integrity, runtime version or explicit .NET validation failed; runtime probe not started.'); return probeRuntime(manifest, invoke); });
    await check('fixed bridge import', async () => { const result = await invoke(path.join(w, 'deps/bridge-venv/bin/python'), ['-I', '-B', '-c', PY_IMPORT], { env: ownedEnv(manifest), timeout: 10_000 }); if (result.output.trim() !== PINS.bridge + '|' + PINS.bridge) throw new Error('Bridge version mismatch.'); return PINS.bridge; });
    await check('pinned addon bytes', async () => { for (const row of manifest.addonFiles ?? []) { const candidate = path.resolve(w, 'project', row.path); if (!inside(path.join(w, 'project'), candidate) || sha(await fs.readFile(candidate)) !== row.sha256) throw new Error('Addon file changed: ' + row.path); } if (!manifest.addonFiles?.length) throw new Error('Addon inventory is missing.'); return manifest.addonFiles.length + ' original addon files'; });
    await check('installed plugin bytes', async () => { const pkg = await verifyPackage(manifest.package.path, manifest.package.sha256); const installed = path.join(w, 'dsh-home/profiles', PROFILE, 'node_modules/dsh-gamedev'); for (const [relative, expected] of pkg.files) if (sha(await fs.readFile(path.join(installed, relative))) !== sha(expected)) throw new Error('Installed file differs: ' + relative); return pkg.files.size + ' package files'; });
    await check('dedicated loopback ports', async () => { await assertFree(manifest.webPort); await assertFree(manifest.bridgePort); return { web: manifest.webPort, bridge: manifest.bridgePort }; });
    await check('macOS Godot signature', async () => (await invoke('/usr/bin/codesign', ['--verify', '--strict', manifest.godotCopy], { timeout: 15_000, env: ownedEnv(manifest) })).output || 'standalone binary strict signature valid', false);
  }
  return { status: checks.some(x => x.required && x.status !== 'PASS') ? 'NO_GO' : 'GO', scope: 'Software-path checks are read-only. Checking a development directory also runs a temporary headless test project with a time limit. Check editor graphics, model connections and game exports separately.', checks };
}
async function acquire(manifest, operation) {
  const lock = path.join(manifest.workspace, 'state/launch.lock');
  const handle = await fs.open(lock, 'wx', 0o600).catch(error => { if (error.code === 'EEXIST') throw new Error('Owned launch lock exists. Refusing concurrent launch/uninstall; inspect it and its PID.'); throw error; });
  await handle.writeFile(json({ ownerId: manifest.id, operation, pid: process.pid, startedAt: new Date().toISOString() })); await handle.close();
  return async () => { const content = JSON.parse(await fs.readFile(lock, 'utf8')); if (content.ownerId !== manifest.id || content.pid !== process.pid || content.operation !== operation) throw new Error('Launch lock ownership changed; lock retained for review.'); await fs.unlink(lock); };
}
export async function launch(options) {
  const manifest = await readOwner(options.workspace);
  if (manifest.state !== 'READY') throw new Error('Workspace is not READY. Run prepare in a new workspace.');
  const readiness = await doctor({ workspace: manifest.workspace });
  if (readiness.status !== 'GO') throw new Error(json(readiness));
  const release = await acquire(manifest, 'launch');
  const children = []; const token = randomBytes(32).toString('base64url');
  const env = ownedEnv(manifest, { [TOKEN_REF]: token, GODOT_MCP_BRIDGE_TOKEN: token, GODOT_MCP_BRIDGE_URL: 'ws://127.0.0.1:' + manifest.bridgePort });
  let shuttingDown = false; let signalCode = 0; let termination; let logFailure;
  const logs = [];
  const terminate = () => termination ??= (async () => {
    shuttingDown = true;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 8000); timer.unref();
      child.once('close', () => { clearTimeout(timer); resolve(); });
    })));
  })();
  const onSignal = signal => { signalCode = signal === 'SIGINT' ? 130 : 143; void terminate(); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    const spawnOwned = async (name, program, args) => {
      if (shuttingDown) throw new Error('Launch canceled before child startup.');
      const log = await fs.open(path.join(manifest.workspace, 'logs', name + '-latest.log'), 'w', 0o600);
      const output = { log, tail: Promise.resolve(), failed: false }; logs.push(output);
      if (shuttingDown) throw new Error('Launch canceled before child startup.');
      const child = spawn(program, args, { cwd: path.join(manifest.workspace, 'project'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); children.push(child);
      const emit = text => {
        if (!output.failed) output.tail = output.tail.then(() => log.write(text)).catch(() => {
          output.failed = true; logFailure = 'Cannot retain ' + name + ' output; stopping only this launch.'; void terminate();
        });
        if (/error|failed/i.test(text)) process.stderr.write(name + ': ' + text);
      };
      for (const stream of [child.stdout, child.stderr]) {
        const redactor = streamScrubber(emit, [token]); stream.on('data', chunk => redactor.write(chunk)); stream.on('end', () => redactor.end());
      }
      const completed = new Promise(resolve => { child.once('close', (code, signal) => resolve({ name, code, signal })); child.once('error', error => resolve({ name, code: 1, error: error.code })); });
      return { child, completed };
    };
    const args = ['--profile', PROFILE, '--port', String(manifest.webPort)];
    if (options['no-open']) args.push('--no-open');
    const host = await spawnOwned('dsh', manifest.tools.paths.dsh, args);
    const editor = await spawnOwned('godot', manifest.godotCopy, ['--editor', '--path', path.join(manifest.workspace, 'project'), '--rendering-method', 'gl_compatibility']);
    process.stdout.write('DSH and Godot started for this development directory. Create a Godot 2D session using its project/ folder, and configure your model connection in DSH.\n');
    process.stdout.write('Browser: http://127.0.0.1:' + manifest.webPort + '/ (native launch opens authentication). Ctrl+C closes these two owned children.\n');
    const first = await Promise.race([host.completed, editor.completed]); await terminate();
    return { status: signalCode || first.code || logFailure ? 'STOPPED_WITH_ERROR' : 'STOPPED', firstExited: first, exitCode: signalCode || first.code || (logFailure ? 1 : 0), ...(logFailure ? { error: logFailure } : {}), runtimeUserData: manifest.runtimeUserData, note: 'Only directly launched children are signalled. Game child processes, game files, caches and saves are retained; close a running game normally in Godot.' };
  } finally {
    await terminate(); await Promise.all(logs.map(output => output.tail)); await Promise.all(logs.map(output => output.log.close()));
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); await release();
  }
}
async function regularPatch(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Profile patch must remain a regular file.');
  return fs.readFile(file);
}
export async function planOverrideRemoval(manifest, patchFile, current, parserRun = run) {
  const script = await fs.readFile(path.join(ROOT, 'scripts/setup/remove_override.py'), 'utf8');
  let output;
  try {
    // Private machine output contains the replacement. Never write it to logs or stdout.
    output = (await parserRun(path.join(manifest.workspace, 'deps/bridge-venv/bin/python'), ['-I', '-B', '-c', script, patchFile, sha(current)], { env: ownedEnv(manifest), cwd: manifest.workspace, timeout: 10_000 })).output;
  } catch (error) {
    const code = /DSH_GAMEDEV_OVERRIDE_ERROR:([a-z_]+)/.exec(error.output ?? '')?.[1] ?? 'parser_unavailable';
    throw new Error('Profile override removal refused (' + code + '). Current patch retained for review.');
  }
  try {
    const plan = JSON.parse(output);
    const replacement = Buffer.from(plan.replacementBase64, 'base64');
    if (plan.sourceSHA256 !== sha(current) || typeof plan.changed !== 'boolean' || replacement.toString('base64') !== plan.replacementBase64 || sha(replacement) !== plan.replacementSHA256 || (!plan.changed && !replacement.equals(current))) throw new Error();
    return { sourceSHA256: plan.sourceSHA256, replacementSHA256: plan.replacementSHA256, changed: plan.changed, replacement };
  } catch { throw new Error('Profile override removal parser returned an invalid private plan.'); }
}
export async function uninstall(options, hooks = {}) {
  const manifest = await readOwner(options.workspace);
  if (manifest.state !== 'READY' && manifest.state !== 'UNINSTALLED') throw new Error('Only a READY or already UNINSTALLED workspace can be removed. Failed setup is retained for manual review.');
  if (manifest.state === 'UNINSTALLED') return { status: 'ALREADY_UNINSTALLED', retained: manifest.retainedOnUninstall };
  const release = await acquire(manifest, 'uninstall');
  try {
    await assertFree(manifest.webPort); await assertFree(manifest.bridgePort);
    const profile = path.join(manifest.workspace, 'dsh-home/profiles', PROFILE);
    const patchFile = path.join(profile, 'cordis.patch.yml'); const current = await regularPatch(patchFile);
    await planOverrideRemoval(manifest, patchFile, current, hooks.parserRun);
    const backup = patchFile + '.before-uninstall' + (await exists(patchFile + '.before-uninstall') ? '-' + randomUUID() : '');
    await fs.writeFile(backup, current, { flag: 'wx', mode: 0o600 });
    if (sha(await regularPatch(patchFile)) !== sha(current)) throw new Error('Profile patch changed after validation. Exact backup retained; retry after the writer stops.');
    const result = await (hooks.run ?? run)(manifest.tools.paths.dsh, ['plugin', '--profile', PROFILE, 'remove', 'dsh-gamedev'], { env: ownedEnv(manifest), cwd: manifest.workspace, timeout: 180_000 });
    await fs.writeFile(path.join(manifest.workspace, 'logs/uninstall-plugin.log'), result.output, { mode: 0o600 });
    // Native removal may reserialize or remove the row itself. Re-read its result;
    // remove only the validated row span and preserve every other current byte.
    const afterNative = await regularPatch(patchFile);
    const plan = await planOverrideRemoval(manifest, patchFile, afterNative, hooks.parserRun);
    if (plan.changed) {
      const temporary = patchFile + '.uninstall-' + randomUUID() + '.next';
      try {
        await fs.writeFile(temporary, plan.replacement, { flag: 'wx', mode: 0o600 });
        if (sha(await regularPatch(patchFile)) !== plan.sourceSHA256) throw new Error('Profile patch changed before replacement. Backup and current patch retained; retry after the writer stops.');
        await fs.rename(temporary, patchFile);
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    manifest.state = 'UNINSTALLED'; manifest.uninstalledAt = new Date().toISOString(); manifest.uninstallBackup = path.relative(manifest.workspace, backup); await writeOwner(manifest);
    return { status: 'UNINSTALLED', retained: manifest.retainedOnUninstall, note: 'Project, addon, runtime saves, interpreter, engine copy and entire isolated Home retained.' };
  } finally { await release(); }
}
const HELP = `dsh-gamedev local setup (Node 24.14+; tested macOS arm64 CPython 3.14)

  doctor --dsh /abs/dsh --godot /abs/Godot.app/Contents/MacOS/Godot --python /abs/python3.14 [--dotnet /abs/dotnet]
  prepare --workspace /abs/NEW-directory --dsh /abs/dsh --godot /abs/Godot.app/Contents/MacOS/Godot --python /abs/python3.14 [--dotnet /abs/dotnet] --package /abs/plugin.tgz --package-sha256 <64hex> --offline --find-links /abs/wheelhouse
  prepare <same paths> --allow-download [--find-links /abs/wheelhouse]
  doctor --workspace /abs/owned-directory
  launch --workspace /abs/owned-directory [--no-open]
  uninstall --workspace /abs/owned-directory

prepare defaults: --port 53190 --bridge-port 19090. No default Profile, current game,
software installation, model account or global package/config is changed. Token values
exist only in launch process environments. prepare creates a new empty Godot project.
Mono Godot requires an explicit existing --dotnet. Standard Godot does not require it.
`;
export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs([...argv]);
  if (command === 'help' || options.help) { process.stdout.write(HELP); return 0; }
  const allowed = {
    doctor: ['workspace', 'dsh', 'godot', 'python', 'dotnet', 'package', 'package-sha256', 'json'],
    prepare: ['workspace', 'dsh', 'godot', 'python', 'dotnet', 'package', 'package-sha256', 'offline', 'allow-download', 'find-links', 'port', 'bridge-port', 'json'],
    launch: ['workspace', 'no-open', 'json'], uninstall: ['workspace', 'json'],
  }[command];
  if (!allowed) throw new Error('Unknown command: ' + command);
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error('--' + key + ' does not apply to ' + command);
  let result;
  if (command === 'doctor') result = await doctor(options);
  else if (command === 'prepare') { const manifest = await prepare(options); result = { status: manifest.state, workspace: manifest.workspace, package: manifest.package, next: 'Run doctor --workspace and launch --workspace with this same helper.', runtimeUserData: manifest.runtimeUserData }; }
  else if (command === 'launch') result = await launch(options);
  else if (command === 'uninstall') result = await uninstall(options);
  else throw new Error('Unknown command: ' + command);
  process.stdout.write(json(result));
  return result.status === 'NO_GO' ? 1 : result.exitCode ?? 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(scrub(error.message) + '\n'); process.exitCode = 1; });
}
