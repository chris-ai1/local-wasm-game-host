// Authors: Christian Reitwiessner
import { GameRuntime } from './runtime.js';
import {LocalFiles} from './file-storage.js';
const runtime = new GameRuntime();
const files = new LocalFiles();
let queue=Promise.resolve();
async function handle(message) {
  try {
    let snapshot;
    if (message.type === 'load') { snapshot = await runtime.load(message.binary, message.data,{improvedMode:message.improvedMode===true});files.attach(runtime.api); }
    else if (message.type === 'input') snapshot = runtime.input(message.kind, message.a, message.b);
    else if (message.type === 'inputs') {
      if(!Array.isArray(message.events)||message.events.length>32)throw new Error('Invalid input batch.');
      for(const event of message.events){runtime.inputs([event]);await files.pump();}
      snapshot=runtime.snapshot();
    }
    else if(message.type==='files-list'){self.postMessage({id:message.id,paths:await files.list()});return;}
    else if(message.type==='files-import'){await files.import(message.path,new Uint8Array(message.bytes));self.postMessage({id:message.id});return;}
    else if(message.type==='files-export'){const bytes=await files.export(message.path);self.postMessage({id:message.id,bytes},[bytes.buffer]);return;}
    else if (message.type === 'tick') snapshot = runtime.tick(message.milliseconds);
    else if (message.type === 'audio-configure') {
      self.postMessage({id: message.id, supported: runtime.configureAudio(message.rate)}); return;
    }
    else if (message.type === 'audio') {
      const pcm=runtime.audio(message.frames);
      self.postMessage({id: message.id, pcm},[pcm.buffer]); return;
    }
    else throw new Error('Unknown host request.');
    await files.pump();snapshot=runtime.snapshot();
    const fileWarning=files.lastError?.message;files.lastError=undefined;
    self.postMessage({id: message.id, ...snapshot, fileSupported:!!files.namespace, fileRevision:files.revision, fileWarning, fileDirectory:files.defaultDirectory, animated: runtime.animated, pointerMotion: runtime.pointerMotion, audioSupported: runtime.audioSupported}, [snapshot.frame.buffer]);
  } catch (error) {
    self.postMessage({id: message.id, error: error.message || String(error)});
  }
}
self.onmessage=({data})=>{queue=queue.then(()=>handle(data));};
