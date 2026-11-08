// Authors: Christian Reitwiessner
import {copyFile, mkdir, rm} from 'node:fs/promises';
await rm('dist', {recursive: true, force: true});
await mkdir('dist');
for (const file of ['index.html', 'style.css', 'tokens.css', 'app.js', 'worker.js', 'runtime.js', 'ABI.md']) await copyFile(file, `dist/${file}`);
await copyFile('LICENSE', 'dist/LICENSE');
console.log('Built static host. No game binaries or data are included.');
