import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

function requiredBuildValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} må settes i byggmiljøet.`);
  return value;
}

const supabaseUrl = requiredBuildValue('SUPABASE_URL');
const supabasePublishableKey = requiredBuildValue('SUPABASE_PUBLISHABLE_KEY');
const parsedSupabaseUrl = new URL(supabaseUrl);
if (parsedSupabaseUrl.protocol !== 'https:' || !parsedSupabaseUrl.hostname.endsWith('.supabase.co')) {
  throw new Error('SUPABASE_URL må være en HTTPS-adresse hos Supabase.');
}
if (!supabasePublishableKey.startsWith('sb_publishable_')) {
  throw new Error('SUPABASE_PUBLISHABLE_KEY må være en publishable key, aldri en secret/service-role key.');
}

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
  define: {
    __SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey),
  },
});
