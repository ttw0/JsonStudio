import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function generateChecksums(directory, tag) {
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  const required = [
    `Json.Studio_${version}_linux_amd64.AppImage`,
    `Json.Studio_${version}_macos_aarch64.app.tar.gz`,
    `Json.Studio_${version}_macos_x64.app.tar.gz`,
    `Json.Studio_${version}_windows_x64-setup.exe`,
  ];
  const files = new Map();
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (!file.isFile()) continue;
    const normalized = file.name.replaceAll(' ', '.');
    if (!required.includes(normalized)) continue;
    if (files.has(normalized)) throw new Error(`Duplicate release asset: ${normalized}`);
    files.set(normalized, file.name);
  }
  const lines = [];
  for (const name of required) {
    if (!files.has(name)) throw new Error(`Missing release asset: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(directory, files.get(name)))) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  const contents = `${lines.join('\n')}\n`;
  await writeFile(path.join(directory, 'SHA256SUMS'), contents);
  return contents;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , directory, tag] = process.argv;
  if (!directory || !tag) throw new Error('Usage: node scripts/generate-install-checksums.mjs DIRECTORY TAG');
  console.log(await generateChecksums(directory, tag));
}
