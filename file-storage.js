// Authors: Christian Reitwiessner
// Optional Local Game ABI files. IndexedDB and downloads stay on this device.
const decoder = new TextDecoder('utf-8', {fatal:true});
const encoder = new TextEncoder();
const LIMIT = 16 * 1024 * 1024;
const FUNCTIONS = ['game_file_kind','game_file_path_ptr','game_file_path_len',
  'game_file_data_ptr','game_file_data_len','game_file_limit','game_file_reply',
  'game_file_namespace_ptr','game_file_namespace_len'];
export function relativePath(path) {
  if(typeof path!=='string'||!path.length||path.length>1024||path.includes('\\')||path.includes('\0')||path.split('/').some(x=>!x||x==='.'||x==='..')||path.includes(':'))throw new Error('Invalid local relative file path.');
  return path;
}
const key = path => relativePath(path).replace(/[A-Z]/g,c=>c.toLowerCase());
export class BrowserFileStore {
  constructor(factory=globalThis.indexedDB) { this.factory=factory; }
  database() {
    if(!this.opening)this.opening=new Promise((resolve,reject)=>{
      if(!this.factory){reject(new Error('This browser does not provide local file storage.'));return;}
      const request=this.factory.open('local-game-files-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:['namespace','key']});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Local file storage is blocked by another tab.'));
    });
    return this.opening;
  }
  async transaction(mode, action) {
    const db=await this.database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('files',mode);let result;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error('Local file transaction failed.'));
      tx.onabort=()=>reject(tx.error||new Error('Local file transaction aborted.'));
      try {action(tx.objectStore('files'),value=>{result=value;});} catch(error){tx.abort();reject(error);}
    });
  }
  async list(namespace) {
    const records=await this.transaction('readonly',(store,done)=>{
      const request=store.getAll();request.onsuccess=()=>done(request.result.filter(r=>r.namespace===namespace));
    });
    return records.map(({path})=>path);
  }
  async read(namespace,path) {
    const result=await this.transaction('readonly',(store,done)=>{
      const request=store.get([namespace,key(path)]);request.onsuccess=()=>done(request.result);
    });
    if(!result)throw new Error(`Local file not found: ${path}`);
    return new Uint8Array(result.bytes);
  }
  async write(namespace,path,bytes) {
    if(bytes.byteLength>LIMIT)throw new Error('Local file exceeds 16 MiB.');
    const lookup=key(path),copy=bytes.slice().buffer;
    await this.transaction('readwrite',store=>{
      const request=store.get([namespace,lookup]);
      // DOS-style case-insensitive overwrite retains the existing basename.
      request.onsuccess=()=>store.put({namespace,key:lookup,path:request.result?.path||path,bytes:copy});
    });
  }
}
export class LocalFiles {
  constructor(store=new BrowserFileStore()) {this.store=store;this.namespace='';this.defaultDirectory='';}
  attach(api) {
    this.generation=(this.generation||0)+1;this.api=api;this.namespace='';this.defaultDirectory='';this.revision=0;this.lastError=undefined;
    const present=FUNCTIONS.filter(name=>typeof api[name]==='function').length;
    if(!present)return false;
    if(present!==FUNCTIONS.length)throw new Error('The game has an incomplete local file interface.');
    this.namespace=this.text(api.game_file_namespace_ptr(),api.game_file_namespace_len());
    if(!this.namespace||this.namespace.length>128)throw new Error('Invalid local file namespace.');
    if(typeof api.game_file_default_dir_ptr==='function'&&typeof api.game_file_default_dir_len==='function'){
      this.defaultDirectory=this.text(api.game_file_default_dir_ptr(),api.game_file_default_dir_len());
      if(this.defaultDirectory)relativePath(this.defaultDirectory);
    }
    return true;
  }
  range(pointer,length) {
    const at=pointer>>>0;
    if(!Number.isInteger(length)||length<0||length>LIMIT||at>this.api.memory.buffer.byteLength||length>this.api.memory.buffer.byteLength-at)throw new Error('Invalid local file memory range.');
    return new Uint8Array(this.api.memory.buffer,at,length);
  }
  text(pointer,length) {
    if(length>4096)throw new Error('Oversized local file path.');
    return decoder.decode(this.range(pointer,length));
  }
  async pump() {
    if(!this.namespace)return;
    const api=this.api,generation=this.generation,namespace=this.namespace;
    for(let requests=0;requests<16;requests++){
      const kind=api.game_file_kind();if(kind===0)return;
      const path=relativePath(this.text(api.game_file_path_ptr(),api.game_file_path_len()));
      let bytes=new Uint8Array(),opened=1;
      try {
        if(kind===1){
          const prefix=key(path)+'/';const chunks=[];let total=0;
          for(const name of await this.store.list(namespace)){
            if(!key(name).startsWith(prefix))continue;
            const basename=name.slice(prefix.length);if(!basename||basename.includes('/'))continue;
            const encoded=encoder.encode(basename);if(encoded.length>65535)throw new Error('Local filename too long.');
            const chunk=new Uint8Array(encoded.length+2);new DataView(chunk.buffer).setUint16(0,encoded.length);chunk.set(encoded,2);chunks.push(chunk);total+=chunk.length;
            if(total>LIMIT)throw new Error('Local directory reply exceeds 16 MiB.');
          }
          bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
        } else if(kind===2){
          const limit=api.game_file_limit();if(!Number.isInteger(limit)||limit<0||limit>LIMIT)throw new Error('Invalid local read limit.');
          bytes=(await this.store.read(namespace,path)).slice(0,limit);
        } else if(kind===3){
          bytes=this.range(api.game_file_data_ptr(),api.game_file_data_len()).slice();
          await this.store.write(namespace,path,bytes);if(generation===this.generation)this.revision++;bytes=new Uint8Array();
        } else throw new Error('Unknown local file request.');
      } catch(error) {
        // Missing paths and failed opens are delivered to the original game.
        // Keep a diagnostic available to the host alongside its continuation.
        opened=0;bytes=new Uint8Array();if(generation===this.generation)this.lastError=error;
      }
      if(generation!==this.generation)return;
      const pointer=api.input_resize(bytes.length);
      if(!pointer&&bytes.length)throw new Error('Could not allocate local file reply.');
      this.range(pointer,bytes.length).set(bytes);
      if(api.game_file_reply(opened)!==1){
        const error=this.text(api.error_ptr(),api.error_len());throw new Error(error||'Game local file reply failed.');
      }
    }
    throw new Error('Too many consecutive local file requests.');
  }
  async list(){return this.namespace?this.store.list(this.namespace):[];}
  async import(path,bytes){if(!this.namespace)throw new Error('Start a game with local file support first.');await this.store.write(this.namespace,relativePath(path),bytes);}
  async export(path){if(!this.namespace)throw new Error('No local file game is running.');return this.store.read(this.namespace,relativePath(path));}
}
