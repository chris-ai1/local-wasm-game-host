// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRuntime} from '../runtime.js';
import {AudioOutput} from '../audio-output.js';
import {fixture} from './fixture.mjs';

test('optional audio validates buffers, survives memory growth and retains copies',async()=>{
  const runtime=new GameRuntime();await runtime.load(fixture(),null);
  assert.equal(runtime.audioSupported,false);assert.equal(runtime.configureAudio(48000),false);
  assert.throws(()=>runtime.audio(1),/not configured/);
  await runtime.load(fixture({audio:true,audioGrow:true}),null);
  assert.equal(runtime.configureAudio(48000),true);
  assert.throws(()=>runtime.audio(8193),/block size/);
  assert.throws(()=>runtime.audio(0),/block size/);
  assert.throws(()=>runtime.audio(1.5),/block size/);
  const bytes=runtime.audio(2);assert.deepEqual([...bytes],[0,64,0,192,0,32,0,224]);
  runtime.range(640,8).fill(0);runtime.audio(2);
  assert.equal(bytes[1],64);
  for(const options of [{audio:true,audioLength:0},{audio:true,audioPointer:-1},{audio:true,audioPointer:65534}]){
    await runtime.load(fixture(options),null);runtime.configureAudio(48000);
    assert.throws(()=>runtime.audio(2),/audio buffer length|memory range/);
  }
  await runtime.load(fixture({audio:true,missing:'game_audio_render'}),null);
  assert.throws(()=>runtime.configureAudio(48000),/incomplete audio/);
  await runtime.load(fixture({audio:true,badAudio:true}),null);
  assert.throws(()=>runtime.configureAudio(48000),/test failure/);
  await runtime.load(fixture(),null);assert.equal(runtime.audioRate,0);
});

class Context {
  state='running';currentTime=0;sampleRate=48000;buffers=[];starts=[];destination={};
  resume(){return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
  createGain(){return {gain:{value:1,setValueAtTime(value){this.value=value;}},connect(){},disconnect(){}};}
  createBuffer(channels,frames){const data=Array.from({length:channels},()=>new Float32Array(frames));const buffer={getChannelData:i=>data[i]};this.buffers.push(buffer);return buffer;}
  createBufferSource(){return {connect(){},disconnect(){},start:when=>this.starts.push(when)};}
}
function block(frames){const data=new Uint8Array(frames*4),view=new DataView(data.buffer);for(let i=0;i<frames;i++){view.setInt16(i*4,16384,true);view.setInt16(i*4+2,-16384,true);}return data;}
test('schedules bounded stereo, mute preserves clock, Stop drops late results',async()=>{
  const previous=globalThis.AudioContext;globalThis.AudioContext=Context;
  try{
    const audio=new AudioOutput();await audio.start(async()=>true,async frames=>block(frames),error=>{throw error;});
    assert.ok(audio.context.starts.length<=4);assert.equal(audio.context.buffers[0].getChannelData(0)[0],0.5);assert.equal(audio.context.buffers[0].getChannelData(1)[0],-0.5);
    const next=audio.next;audio.setMuted(true);assert.equal(audio.gain.gain.value,0);assert.equal(audio.next,next);audio.setMuted(false);assert.equal(audio.gain.gain.value,1);audio.stop();assert.equal(audio.context.state,'closed');
    const delayed=new AudioOutput();let resolve;const started=delayed.start(async()=>true,()=>new Promise(r=>{resolve=r;}),error=>{throw error;});
    while(!resolve)await new Promise(r=>setImmediate(r));
    delayed.stop();resolve(block(2048));await started;assert.equal(delayed.context.starts.length,0);
    const slow=new AudioOutput();let calls=0;await slow.start(async()=>true,async frames=>{calls++;slow.context.currentTime++;return block(frames);},error=>{throw error;});slow.stop();assert.equal(calls,4);
    const bad=new AudioOutput();let error;await bad.start(async()=>true,async()=>new Uint8Array(1),e=>{error=e;});assert.match(error.message,/audio block/);assert.equal(bad.stopped,true);
  }finally{globalThis.AudioContext=previous;}
});
