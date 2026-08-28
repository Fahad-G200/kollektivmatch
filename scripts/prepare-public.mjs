import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootUrl = new URL('../', import.meta.url);
const publicUrl = new URL('../public/', import.meta.url);
const root = fileURLToPath(rootUrl);
const publicDir = fileURLToPath(publicUrl);
const excludedLegacyFiles = new Set([
  'vipps-verification-result.html',
  'vipps-verification-result.js',
]);

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

for (const name of ['assets', 'css']) {
  await cp(join(root, name), join(publicDir, name), { recursive: true });
}

await cp(join(root, '_headers'), join(publicDir, '_headers'));

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || !['.html', '.js'].includes(extname(entry.name))) continue;
  if (excludedLegacyFiles.has(entry.name)) continue;
  if (entry.name === 'supabase-config.js') continue;
  await cp(join(root, entry.name), join(publicDir, entry.name));
}

// Bundle the pinned Supabase dependency into our own origin. The browser never
// needs to execute mutable third-party CDN code during authentication.
await build({
  entryPoints: [join(root, 'supabase-config.js')],
  outfile: join(publicDir, 'supabase-config.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
});
