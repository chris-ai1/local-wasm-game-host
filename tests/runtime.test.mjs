// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameRuntime} from '../runtime.js';
import {fixture} from './fixture.mjs';

test('runs a generic module with local data and copies RGBA output',async()=>{
  const game=new GameRuntime();
  const frame=await game.load(fixture(),new Uint8Array([1,2,3]).buffer);
  assert.equal(frame.width,2);assert.equal(frame.height,1);assert.equal(frame.status,'Ready');
  assert.deepEqual([...frame.frame],[0,11,12,255,100,101,102,255]);
  assert.deepEqual([...game.range(4096,3)],[1,2,3]);
  assert.deepEqual([...game.input(5,77,4).frame].slice(0,2),[5,77]);
  assert.equal(frame.frame[0],0); // Frame survives subsequent Wasm writes.
  assert.deepEqual([...game.inputs([{kind:1,a:65,b:0},{kind:1,a:66,b:0}]).frame].slice(0,2),[1,66]);
  assert.throws(()=>game.inputs(Array(33).fill({kind:1,a:0,b:0})),/input batch/);
});

test('supports no-data games, memory growth, and optional ticks',async()=>{
  const game=new GameRuntime();await game.load(fixture({grow:true,tick:true}),null);
  assert.equal(game.api.memory.buffer.byteLength,131072);
  assert.equal(game.animated,true);assert.equal(game.tick(20).status,'Ready');
  await game.load(fixture(),new ArrayBuffer(0));assert.equal(game.animated,false);
});

test('sends optional pointer motion through its own export, preserving old modules',async()=>{
  const game=new GameRuntime();await game.load(fixture({motion:true}),null);
  assert.equal(game.pointerMotion,true);assert.equal(game.input(10,91,0).frame[2],91);
  await game.load(fixture(),null);assert.equal(game.pointerMotion,false);
  assert.equal(game.input(10,91,0).frame[0],0);
});

test('physical key mode is optional and carries USB usage plus press/release',async()=>{
  const game=new GameRuntime();let frame=await game.load(fixture({physical:true}),null);
  assert.equal(frame.physicalKeyboard,true);
  assert.deepEqual([...game.input(12,59,1).frame].slice(0,3),[12,59,1]);
  assert.deepEqual([...game.input(12,59,0).frame].slice(0,3),[12,59,0]);
  frame=await game.load(fixture(),null);assert.equal(frame.physicalKeyboard,false);
});

test('rejects incompatible modules, imports, versions, and game errors',async()=>{
  for(const [options,pattern] of [[{missing:'game_input'},/missing game_input/],[{imports:true},/external imports/],[{version:2},/interface version/],[{badStart:true},/test failure/]]){
    await assert.rejects(new GameRuntime().load(fixture(options),null),pattern);
  }
  await assert.rejects(new GameRuntime().load(new Uint8Array([1,2,3]),null),/compiled .wasm game or a ZIP/);
});

test('rejects invalid framebuffer dimensions and memory ranges',async()=>{
  for(const [options,pattern] of [[{width:0},/display size/],[{height:2049},/display size/],[{pointer:65532},/memory range/],[{pointer:-1},/memory range/]]){
    await assert.rejects(new GameRuntime().load(fixture(options),null),pattern);
  }
});

test('optional real game build accepts local data through the generic ABI',{skip:!process.env.GAME_WASM},async()=>{
  const game=new GameRuntime();const binary=await readFile(process.env.GAME_WASM);
  const data=process.env.GAME_DATA?new Uint8Array(await readFile(process.env.GAME_DATA)).buffer:null;
  const first=await game.load(binary,data);
  assert.equal(first.width,320);assert.equal(first.height,200);assert.match(first.status,/Hauptmenü/);
  assert.match(game.input(1,117,0).status,/Vorname/);
});
