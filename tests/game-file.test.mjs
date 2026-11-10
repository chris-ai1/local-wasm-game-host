// Authors: Christian Reitwiessner
import {originalMenu} from './real-game.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {unpackGame,crc32} from '../game-file.js';
import {GameRuntime} from '../runtime.js';
import {fixture} from './fixture.mjs';
import {zipFixture} from './zip-fixture.mjs';
test('CRC-32 agrees with the independent standard vector',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926));
test('opens stored and compressed builds, nested names, descriptors and ZIP comments',async()=>{
  const wasm=fixture();
  for(const method of [0,8])for(const flags of [0,8]){
    const zip=zipFixture([{name:'folder/GAME.WASM',bytes:wasm,method,flags},{name:'README.txt',bytes:[1,2,3]},{name:'__MACOSX/._GAME.WASM',bytes:[0]}],{comment:'local build'});
    assert.deepEqual([...await unpackGame(zip)],[...wasm]);
    const first=await new GameRuntime().load(zip,null);assert.equal(first.status,'Ready');
  }
});
test('requires exactly one real Wasm file and checks magic',async()=>{
  for(const [entries,pattern] of [
    [[{name:'data.txt',bytes:[1]}],/no .wasm game/],
    [[{name:'one.wasm',bytes:fixture()},{name:'two.wasm',bytes:fixture()}],/multiple .wasm/],
    [[{name:'game.wasm',bytes:[1,2,3]}],/not a WebAssembly binary/],
    [[{name:'game.wasm',bytes:fixture(),flags:1}],/Encrypted/],
    [[{name:'game.wasm',bytes:fixture(),method:99}],/compression method/]
  ])await assert.rejects(unpackGame(zipFixture(entries)),pattern);
});
test('rejects corrupt, truncated, split and oversized game ZIPs',async()=>{
  const make=()=>zipFixture([{name:'game.wasm',bytes:fixture(),method:0}]);
  const damaged=make();damaged[40]^=1;await assert.rejects(unpackGame(damaged),/checksum/);
  await assert.rejects(unpackGame(make().subarray(0,-3)),/central directory/);
  const inconsistent=make();inconsistent.writeUInt16LE(8,8);await assert.rejects(unpackGame(inconsistent),/Inconsistent/);
  const split=make();split.writeUInt16LE(1,split.length-18);await assert.rejects(unpackGame(split),/Split/);
  const large=make(),central=large.readUInt32LE(large.length-6);large.writeUInt32LE(65*1024*1024,central+24);await assert.rejects(unpackGame(large),/size or disk limits/);
});
test('opens the locally packaged real game build',{skip:!process.env.GAME_WASM_ZIP},async()=>{
  const bytes=await readFile(process.env.GAME_WASM_ZIP),game=new GameRuntime();
  const data=process.env.GAME_DATA?new Uint8Array(await readFile(process.env.GAME_DATA)).buffer:null;
  await game.load(bytes,data);originalMenu(game);
});
