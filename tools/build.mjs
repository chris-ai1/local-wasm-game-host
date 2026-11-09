// Authors: Christian Reitwiessner
import {copyFile, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = ['app.js', 'worker.js', 'runtime.js', 'game-file.js', 'physical-key.js', 'style.css', 'tokens.css'];

export async function build(destination = path.join(root, 'dist')) {
  const contents = new Map();
  for (const name of ['index.html', ...assets]) contents.set(name, await readFile(path.join(root, name), 'utf8'));
  const hash = createHash('sha256');
  hash.update(await readFile(fileURLToPath(import.meta.url)));
  for (const [name, text] of contents) hash.update(name).update('\0').update(text).update('\0');
  const version = hash.digest('hex').slice(0, 12);
  const names = new Map(assets.map(name => [name, name.replace(/\.(js|css)$/, `.${version}.$1`)]));
  const rewrite = text => text.replace(/(['"])\.\/([^'"]+)\1/g, (match, quote, name) =>
    names.has(name) ? `${quote}./${names.get(name)}${quote}` : match);
  await rm(destination, {recursive: true, force: true});
  await mkdir(destination, {recursive: true});
  for (const name of assets) await writeFile(path.join(destination, names.get(name)), rewrite(contents.get(name)));
  const html = rewrite(contents.get('index.html')).replace('Development build', `Build ${version}`);
  await writeFile(path.join(destination, 'index.html'), html);
  for (const name of ['ABI.md', 'LICENSE']) await copyFile(path.join(root, name), path.join(destination, name));
  return {version, assets: [...names.values()]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {version} = await build();
  console.log(`Built static host ${version} with versioned assets. No game binaries or data are included.`);
}
