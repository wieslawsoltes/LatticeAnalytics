import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const parts = await Promise.all(Array.from({ length: 9 }, (_, i) => readFile(path.join(directory, `${String(i).padStart(2, '0')}.b64`), 'utf8')));
const encoded = parts.join('');
if (encoded.length !== 96208) throw new Error('Source payload length mismatch');
const compressed = Buffer.from(encoded, 'base64');
if (sha256(compressed) !== '911873ccfc40087e847873f7a933f113f8eba643e56c2d363feea7a90e0ed8d9') throw new Error('Compressed source checksum mismatch');
const decoded = brotliDecompressSync(compressed, { maxOutputLength: 2 * 1024 * 1024 });
if (sha256(decoded) !== '9b4f3d191843fff7ec6c6a729485e44abdca3de7faab78d97d92177880d2ec7f') throw new Error('Decoded source checksum mismatch');
const files = Object.entries(JSON.parse(decoded.toString('utf8')));
if (files.length !== 32) throw new Error('Unexpected source file count');
for (const [relative, contents] of files) {
  if (typeof contents !== 'string' || relative.includes('\\') || relative.split('/').some(segment => !segment || segment === '..') || relative.startsWith('.git') || path.isAbsolute(relative)) throw new Error(`Invalid source path: ${relative}`);
  const destination = path.resolve(root, relative);
  if (!destination.startsWith(root + path.sep)) throw new Error('Source path escapes repository');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, 'utf8');
}
console.log(`Restored ${files.length} source files; both SHA-256 checksums verified.`);
