import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('dist',{recursive:true});
const sources = {};
async function collect(path) {
  for (const entry of await readdir(path,{withFileTypes:true})) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    const file=path+'/'+entry.name;
    if (entry.isDirectory()) await collect(file);
    else sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
for (const path of ['src','bridge','prompts','skills','catalog','contracts','locale','scripts/setup']) await collect(path);
for (const file of ['package.json','cordis.patch.yml','icon.svg','scripts/setup.mjs']) sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const sourceFingerprint=createHash('sha256').update(JSON.stringify(Object.entries(sources).sort())).digest('hex');
await writeFile('dist/build-info.json',JSON.stringify({version:JSON.parse(await readFile('package.json','utf8')).version,sourceFingerprint,sources},null,2)+'\n');
await build({entryPoints:['src/index.ts','src/session.ts','src/config.ts','src/lifecycle.ts'],outdir:'dist',bundle:true,format:'esm',platform:'node',target:'node24',packages:'external',sourcemap:true});
await build({entryPoints:['src/client.tsx'],outfile:'dist/client.js',bundle:true,format:'iife',platform:'browser',target:'es2022',sourcemap:true});
