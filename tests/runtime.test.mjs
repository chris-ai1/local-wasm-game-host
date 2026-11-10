// Authors: Christian Reitwiessner
import {originalMenu} from './real-game.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameRuntime} from '../runtime.js';
import {fixture} from './fixture.mjs';
import {logicalKey,physicalKeyboard} from '../physical-key.js';

test('queued keys use current worker mode across menu and text transitions',async()=>{
  const game=new GameRuntime();await game.load(fixture(),null);
  let mode=1;const calls=[];
  game.api={...game.api,game_keyboard_mode:()=>mode,game_input:(kind,a,b)=>{
    calls.push([kind,a,b]);
    if(kind===12&&a===24&&b===0)mode=0; // U release opens text input.
    if(kind===2)mode=1; // Return closes it.
    return 1;
  }};
  const key=(usage,pressed,fallback=null)=>({keyboard:true,usage,pressed,fallback});
  game.inputs([
    key(24,true,{kind:1,a:117,b:0}),key(24,false),
    key(11,true,{kind:1,a:72,b:0}),key(11,false),
    key(4,true,{kind:1,a:65,b:0}),key(4,true,{kind:1,a:65,b:0}),key(4,false),
    key(40,true,{kind:2,a:0,b:0}),key(40,false),
    key(59,true),key(59,true),key(59,false),
  ]);
  assert.deepEqual(calls,[[12,24,1],[12,24,0],[1,72,0],[1,65,0],[1,65,0],[2,0,0],[12,59,1],[12,59,0]]);
  // A held raw key released after a tick changes mode must still get its up.
  game.inputs([key(22,true)]);mode=0;
  game.inputs([key(22,true,{kind:1,a:115,b:0}),key(22,false)]);
  assert.deepEqual(calls.slice(-2),[[12,22,1],[12,22,0]]);
  // Held logical input cannot become a new physical press through autorepeat.
  game.inputs([key(5,true,{kind:1,a:98,b:0})]);mode=1;
  game.inputs([key(5,true,{kind:1,a:98,b:0}),key(5,false)]);
  assert.deepEqual(calls.at(-1),[1,98,0]);
  await game.load(fixture(),null);
  assert.equal(game.keyboardDown.size,0);
  game.inputs([key(11,true,{kind:1,a:72,b:0}),key(11,false)]);
  assert.deepEqual([...game.snapshot().frame].slice(0,2),[1,72]);
});

test('keyboard capture retains fallback characters, repeats and blur releases',()=>{
  const callbacks=new Map(),sent=[];
  const element={addEventListener:(name,callback)=>callbacks.set(name,callback)};
  const reset=physicalKeyboard(element,{enabled:()=>true,repeats:true,send:(usage,pressed,event)=>sent.push([usage,pressed,logicalKey(event)])});
  const event={code:'KeyA',key:'Ä',preventDefault(){},stopImmediatePropagation(){}};
  callbacks.get('keydown')(event);callbacks.get('keydown')({...event,repeat:true});
  callbacks.get('blur')();callbacks.get('keyup')(event);
  assert.deepEqual(sent,[[4,true,{kind:1,a:196,b:0}],[4,true,{kind:1,a:196,b:0}],[4,false,null]]);
  for(const option of ['ctrlKey','altKey','metaKey','isComposing'])assert.equal(logicalKey({...event,[option]:true}),null);
  assert.deepEqual(logicalKey({...event,key:'😀'}),{kind:1,a:0x1f600,b:0});
  callbacks.get('keydown')(event);reset();callbacks.get('keyup')(event);
  assert.equal(sent.length,4);
});

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

test('optional improvements apply before start and in the ordered input queue',async()=>{
  const game=new GameRuntime();
  const first=await game.load(fixture({improvements:true}),null,{improvedMode:true});
  assert.equal(first.improvedMode,true);assert.equal(first.improvementsSupported,true);
  assert.equal(first.frame[0],1,'game_start sees the selected mode');
  const frame=game.inputs([{improvedMode:false},{kind:1,a:65,b:0}]);
  assert.equal(frame.improvedMode,false);assert.equal(frame.frame[1],65);
  assert.throws(()=>game.setImprovedMode(1),/Original or Improved/);
  game.setImprovedMode(true);assert.equal(game.snapshot().improvedMode,true);
  await game.load(fixture(),null,{improvedMode:true});
  assert.equal(game.snapshot().improvementsSupported,false);
  assert.throws(()=>game.setImprovedMode(true),/does not provide/);
  for(const missing of ['game_improved_mode','game_set_improved_mode']){
    await assert.rejects(game.load(fixture({improvements:true,missing}),null),/incomplete improvements/);
  }
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
  assert.equal(first.width,320);assert.equal(first.height,200);originalMenu(game);
  assert.match(game.input(1,117,0).status,/Vorname/);
});
