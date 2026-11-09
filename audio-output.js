// Authors: Christian Reitwiessner
// Bounded, pull-based PCM playback. This module never opens files or URLs.
export class AudioOutput {
  constructor() {
    const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Context)throw new Error('Web Audio is unavailable in this browser.');
    this.context=new Context({latencyHint:'interactive'});
    // Called synchronously from Start so autoplay permission uses that gesture.
    this.resumed=this.context.resume();
    this.resumed.catch(()=>{});
    this.gain=this.context.createGain();this.gain.connect(this.context.destination);
    this.stopped=false;this.busy=false;this.muted=false;this.next=0;
  }
  async start(configure,pull,onError) {
    await this.resumed;
    if(this.stopped)return;
    if(!await configure(this.context.sampleRate)){this.stop();return;}
    if(this.stopped)return;
    this.pull=pull;this.onError=onError;
    this.timer=setInterval(()=>this.fill(),20);
    await this.fill();
  }
  setMuted(value) {
    this.muted=Boolean(value);
    this.gain.gain.setValueAtTime(this.muted?0:1,this.context.currentTime);
  }
  async fill() {
    if(this.busy||this.stopped||this.context.state!=='running')return;
    this.busy=true;
    try {
      for(let blocks=0;blocks<4&&!this.stopped&&this.next-this.context.currentTime<0.08;blocks++){
        const frames=2048;
        const pcm=await this.pull(frames);
        if(this.stopped)return;
        if(!(pcm instanceof Uint8Array)||pcm.byteLength!==frames*4)throw new Error('Invalid stereo audio block.');
        const buffer=this.context.createBuffer(2,frames,this.context.sampleRate);
        const view=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength);
        for(let channel=0;channel<2;channel++){
          const data=buffer.getChannelData(channel);
          for(let i=0;i<frames;i++)data[i]=view.getInt16(i*4+channel*2,true)/32768;
        }
        const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.gain);
        source.onended=()=>source.disconnect();
        this.next=Math.max(this.next,this.context.currentTime+0.01);
        source.start(this.next);this.next+=frames/this.context.sampleRate;
      }
    } catch(error) {
      if(!this.stopped){this.stop();this.onError(error);}
    } finally {this.busy=false;}
  }
  stop() {
    if(this.stopped)return;
    this.stopped=true;clearInterval(this.timer);
    this.gain.disconnect();this.context.close().catch(()=>{});
  }
}
