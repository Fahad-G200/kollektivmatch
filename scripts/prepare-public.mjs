import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootUrl = new URL('../', import.meta.url);
const publicUrl = new URL('../public/', import.meta.url);
const root = fileURLToPath(rootUrl);
const publicDir = fileURLToPath(publicUrl);

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

for (const name of ['assets', 'css']) {
  await cp(join(root, name), join(publicDir, name), { recursive: true });
}

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || !['.html', '.js'].includes(extname(entry.name))) continue;
  await cp(join(root, entry.name), join(publicDir, entry.name));
}
