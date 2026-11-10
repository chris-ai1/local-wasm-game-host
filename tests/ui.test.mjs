// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRuntime} from '../runtime.js';
import {validatePanel} from '../game-ui.js';
import {fixture} from './fixture.mjs';
const panel=()=>({revision:8,title:'Trading',description:'Local inventory',notice:'',replaceScreen:true,
  field:{key:'amount',label:'Amount',value:'1',number:true,maximum:20},
  actions:[{id:0,label:'Confirm',enabled:true,usesField:true,active:false}],
  rows:[{title:'<script>text only</script>',detail:'Owned 3',actions:[{id:1,label:'Sell all',enabled:true,usesField:false,active:false}]}]});

test('module controls validate bounded fields, unique actions and row shapes',()=>{
  assert.equal(validatePanel(panel()).rows.length,1);
  for(const mutate of [p=>p.revision=-1,p=>p.actions[0].id=NaN,p=>p.rows[0].actions[0].id=0,p=>p.rows=Array(129).fill(p.rows[0]),p=>p.field.maximum=Infinity,p=>p.field=null,p=>p.title='x'.repeat(257)]){
    const p=panel();mutate(p);assert.throws(()=>validatePanel(p),/Invalid game/);
  }
});

test('context actions copy UTF-8 input and reject stale actions without stopping input',async()=>{
  const game=new GameRuntime();await game.load(fixture({ui:true}),null);
  const json=new TextEncoder().encode(JSON.stringify(panel()));game.range(8192,json.length).set(json);
  const calls=[];
  game.api={...game.api,game_ui_len:()=>json.length,game_ui_action:(id,revision)=>{calls.push([id,revision,new TextDecoder().decode(game.range(4096,2))]);return 2;}};
  assert.equal(game.snapshot().ui.title,'Trading');
  const frame=game.inputs([{uiAction:{id:0,revision:8,value:'ü'}},{kind:1,a:65,b:0}]);
  assert.deepEqual(calls,[[0,8,'ü']]);assert.equal(frame.frame[1],65);
  assert.throws(()=>game.uiAction({id:0,revision:-1,value:''}),/Invalid game action/);
  assert.throws(()=>game.uiAction({id:0,revision:8,value:'x'.repeat(1025)}),/too long/);
  game.api={...game.api,game_ui_len:()=>70000};assert.throws(()=>game.snapshot(),/oversized text/);
});

test('context controls are optional and require a complete supported interface',async()=>{
  const game=new GameRuntime();await game.load(fixture(),null);assert.equal(game.snapshot().ui,null);
  assert.throws(()=>game.uiAction({id:0,revision:1,value:''}),/does not supply/);
  for(const missing of ['game_ui_version','game_ui_ptr','game_ui_len','game_ui_action'])await assert.rejects(game.load(fixture({ui:true,missing}),null),/incompatible controls/);
  await assert.rejects(game.load(fixture({ui:true,uiVersion:2}),null),/incompatible controls/);
});
