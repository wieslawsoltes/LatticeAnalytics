#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>readFile(path.join(root,relative),'utf8');
// Modules deliberately have non-conflicting top-level names. Bundle without a third-party toolchain.
const strip=source=>source.replace(/^import\s+.*?;\s*$/gm,'').replace(/^export\s+(?=(?:class|const|let|function|async)\b)/gm,'');
const engine=(await Promise.all(['expression','core'].map(n=>read(`src/${n}.js`)))).map(strip).join('\n');
const worker=engine+'\n'+strip(await read('src/worker.js'));
const main=(await Promise.all(['expression','core','model','renderer','app'].map(n=>read(`src/${n}.js`)))).map(strip).join('\n');
let html=await read('index.html');const css=await read('styles.css');
html=html.replace('<link rel="stylesheet" href="styles.css">',()=>`<style>${css}</style>`);
const inline=`globalThis.__LATTICE_WORKER_SOURCE__=${JSON.stringify(worker)};\n${main}`.replace(/<\/script/gi,'<\\/script');
html=html.replace('<script type="module" src="src/app.js"></script>',()=>`<script type="module">${inline}</script>`);
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/lattice.html'),html);console.log(`Built dist/lattice.html (${Math.round(Buffer.byteLength(html)/1024)} KB), with an embedded worker and no external assets.`);
