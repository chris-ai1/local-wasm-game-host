// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../tools/build.mjs';

test('versions the full script/worker/style graph so cached old assets cannot mix with a new page', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'game-host-build-'));
  try {
    const {version, assets} = await build(path.join(directory, 'site'));
    const names = await readdir(path.join(directory, 'site'));
    assert.equal(assets.length, 8);
    for (const name of assets) assert.ok(names.includes(name));
    assert.ok(!names.includes('app.js')); assert.ok(!names.includes('worker.js'));
    for (const name of ['index.html', ...assets]) {
      const text = await readFile(path.join(directory, 'site', name), 'utf8');
      for (const [, target] of text.matchAll(/['"]\.\/([^'"]+\.(?:js|css))['"]/g)) {
        assert.ok(target.includes(version), `${name} has unversioned reference ${target}`);
        assert.ok(names.includes(target), `${name} refers to missing ${target}`);
      }
    }
    const html = await readFile(path.join(directory, 'site/index.html'), 'utf8');
    assert.ok(html.includes(`Build ${version}`));
    assert.equal((await build(path.join(directory, 'repeat'))).version, version);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
