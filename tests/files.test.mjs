// Authors: Christian Reitwiessner
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BrowserFileStore,LocalFiles,relativePath} from '../file-storage.js';
const encoder=new TextEncoder();
class Store {
  records=new Map();
  async list(namespace){return [...this.records].filter(([k])=>k.startsWith(namespace+':')).map(([,r])=>r.path);}
  async read(namespace,path){const r=this.records.get(namespace+':'+path.toLowerCase());if(!r)throw new Error('missing');return r.bytes.slice();}
  async write(namespace,path,bytes){this.records.set(namespace+':'+path.toLowerCase(),{path,bytes:bytes.slice()});}
}
function api() {
  const memory=new WebAssembly.Memory({initial:2});let kind=0,path='',payload=new Uint8Array(),limit=8,replies=[];
  const range=(at,bytes)=>new Uint8Array(memory.buffer,at,bytes.length).set(bytes);
  range(128,encoder.encode('test-game'));range(160,encoder.encode('Games'));
  return {
    memory,replies,set(k,p,b=new Uint8Array(),l=8){kind=k;path=p;payload=b;limit=l;range(256,encoder.encode(path));range(4096,payload);},
    game_file_kind:()=>kind,game_file_namespace_ptr:()=>128,game_file_namespace_len:()=>9,
    game_file_default_dir_ptr:()=>160,game_file_default_dir_len:()=>5,
    game_file_path_ptr:()=>256,game_file_path_len:()=>encoder.encode(path).length,
    game_file_data_ptr:()=>4096,game_file_data_len:()=>payload.length,game_file_limit:()=>limit,
    input_resize(n){this.replyLength=n;memory.grow(1);return 8192;},
    game_file_reply(opened){replies.push({opened,bytes:new Uint8Array(memory.buffer,8192,this.replyLength).slice()});kind=0;return 1;},
  };
}
test('optional local files preserve binary bytes, namespaces, case lookup, listing and read limits',async()=>{
  const store=new Store(),files=new LocalFiles(store),a=api();assert.equal(files.attach(a),true);
  a.set(3,'Games/HANSE.GAME',new Uint8Array([0,255,17,0,64]));await files.pump();
  assert.deepEqual(a.replies.pop(),{opened:1,bytes:new Uint8Array()});
  await store.write('another-game','Games/PRIVATE.GAME',new Uint8Array([8]));
  a.set(1,'games');await files.pump();assert.equal(new TextDecoder().decode(a.replies.at(-1).bytes.slice(2)),'HANSE.GAME');
  a.set(2,'GAMES/hanse.game',new Uint8Array(),3);await files.pump();assert.deepEqual([...a.replies.at(-1).bytes],[0,255,17]);
  a.set(2,'Games/MISSING.GAME');await files.pump();assert.equal(a.replies.at(-1).opened,0);assert.match(files.lastError.message,/missing/);
  assert.deepEqual([...await files.export('Games/HANSE.GAME')],[0,255,17,0,64]);
});
test('file writes report quota failure and old async operations cannot reply into a replacement game',async()=>{
  const store=new Store(),files=new LocalFiles(store),a=api();files.attach(a);
  store.write=async()=>{throw new Error('quota');};a.set(3,'Games/FAIL.GAME',new Uint8Array([1]));await files.pump();
  assert.equal(a.replies.at(-1).opened,0);assert.match(files.lastError.message,/quota/);
  let release;store.list=()=>new Promise(resolve=>{release=resolve;});a.set(1,'Games');
  const pending=files.pump();files.attach(api());release([]);await pending;assert.equal(a.replies.length,1);assert.equal(files.revision,0);
});
test('old modules remain compatible and paths cannot escape local storage roots',()=>{
  assert.equal(new LocalFiles().attach({}),false);
  assert.throws(()=>new LocalFiles().attach({game_file_kind(){}}),/incomplete/);
  for(const path of ['../a','/a','a/../b','a//b','a\\b','df0:a','a\0b'])assert.throws(()=>relativePath(path));
  assert.equal(relativePath('Games/ALT SAVE.GAME'),'Games/ALT SAVE.GAME');
});

test('root metadata is generic, read-only state is preserved and failed open probes are quiet',async()=>{
  const store=new Store(),files=new LocalFiles(store),a=api();files.attach(a);
  for(const value of [0,1]){
    store.metadata=async()=>new Uint8Array([value]);a.set(4,'');await files.pump();
    assert.deepEqual(a.replies.at(-1),{opened:1,bytes:new Uint8Array([value])});
  }
  store.metadata=async()=>{throw Error('unmounted');};a.set(4,'');await files.pump();
  assert.equal(a.replies.at(-1).opened,0);assert.match(files.lastError.message,/unmounted/);
  files.lastError=undefined;
  a.set(2,'s/startup-sequence',new Uint8Array(),0);await files.pump();
  assert.equal(a.replies.at(-1).opened,0);assert.equal(files.lastError,undefined);
  a.set(2,'missing',new Uint8Array(),4);await files.pump();assert.match(files.lastError.message,/missing/);
  assert.throws(()=>relativePath('')); // The empty-path exception is metadata-only.
});

test('metadata distinguishes a read-only volume from an uncertain mounted-state query',async()=>{
  const store=new BrowserFileStore();
  store.transaction=async mode=>{if(mode==='readwrite')throw new DOMException('protected','ReadOnlyError');};
  assert.deepEqual([...await store.metadata()],[1]);
  store.transaction=async mode=>{if(mode==='readwrite')throw new DOMException('closed concurrently','InvalidStateError');};
  assert.deepEqual([...await store.metadata()],[]);
  store.transaction=async()=>{throw new DOMException('unmounted','InvalidStateError');};
  await assert.rejects(store.metadata(),{name:'InvalidStateError'});
});
