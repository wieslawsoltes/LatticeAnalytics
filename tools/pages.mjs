import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const site = new URL('_site/', root);
await mkdir(site, { recursive: true });
await copyFile(new URL('dist/lattice.html', root), new URL('index.html', site));
await copyFile(new URL('dist/lattice.html', root), new URL('lattice.html', site));
await cp(new URL('examples/', root), new URL('examples/', site), { recursive: true });
await writeFile(new URL('.nojekyll', site), '');
const html = await readFile(new URL('index.html', site));
await writeFile(new URL('build.json', site), JSON.stringify({
  name: 'Lattice Analytics', version: '1.0.0',
  commit: process.env.GITHUB_SHA || null,
  htmlSha256: createHash('sha256').update(html).digest('hex')
}, null, 2) + '\n');
console.log('Built _site/index.html, standalone download, examples, and build metadata.');
