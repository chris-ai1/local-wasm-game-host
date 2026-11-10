// Authors: Christian Reitwiessner
// This module is also used by the Node protocol tests. It has no browser I/O.
import {unpackGame} from './game-file.js';
import {validatePanel} from './game-ui.js';
const FUNCTIONS = ['game_abi_version', 'input_resize', 'game_load', 'game_start',
  'game_input', 'game_frame_width', 'game_frame_height', 'game_frame_ptr',
  'game_status_ptr', 'game_status_len', 'error_ptr', 'error_len'];
const decoder = new TextDecoder();
const MAX_TEXT = 64 * 1024;
const AUDIO = ['game_audio_configure', 'game_audio_render', 'game_audio_ptr', 'game_audio_len'];

export class GameRuntime {
  async load(binary, data, {improvedMode=false}={}) {
    this.api = null;
    this.audioRate = 0;
    this.keyboardDown = new Map();
    const module = await WebAssembly.compile(await unpackGame(binary));
    if (WebAssembly.Module.imports(module).length) {
      throw new Error('This game needs external imports. Choose a self-contained Local Game ABI v1 build.');
    }
    const api = new WebAssembly.Instance(module, {}).exports;
    for (const name of FUNCTIONS) {
      if (typeof api[name] !== 'function') throw new Error(`Incompatible game: missing ${name}. Use a Local Game ABI v1 build.`);
    }
    if (!(api.memory instanceof WebAssembly.Memory)) throw new Error('Incompatible game: missing exported memory.');
    if (api.game_abi_version() !== 1) throw new Error('Unsupported game interface version. This host supports Local Game ABI v1.');
    this.api = api;
    const uiExports=['game_ui_version','game_ui_ptr','game_ui_len','game_ui_action'];
    if(uiExports.some(name=>typeof api[name]==='function')&&(!uiExports.every(name=>typeof api[name]==='function')||api.game_ui_version()!==1))throw new Error('The game has an incompatible controls interface.');
    // A missing data file means no game_load call. Some games need no data.
    if (data !== null) {
      const bytes = new Uint8Array(data);
      const pointer = api.input_resize(bytes.length);
      if (pointer === 0 && bytes.length !== 0) throw new Error(this.error('Game could not allocate its data buffer.'));
      this.range(pointer, bytes.length).set(bytes);
      this.check(api.game_load(), 'Game data could not be loaded.');
    }
    const modeExports=['game_improved_mode','game_set_improved_mode'];
    if(modeExports.some(name=>typeof api[name]==='function')&&!this.improvementsSupported)throw new Error('The game has an incomplete improvements interface.');
    if(this.improvementsSupported)this.setImprovedMode(improvedMode);
    this.check(api.game_start(), 'Game could not start.');
    return this.snapshot();
  }

  range(pointer, length) {
    const memory = this.api.memory.buffer;
    // Wasm i32 results arrive as signed JS numbers, even for addresses.
    if (!Number.isInteger(pointer) || pointer < -0x80000000 || pointer > 0xffffffff) {
      throw new Error('The game returned an invalid memory range.');
    }
    const address = pointer >>> 0;
    if (!Number.isInteger(length) || length < 0 ||
        address > memory.byteLength || length > memory.byteLength - address) {
      throw new Error('The game returned an invalid memory range.');
    }
    return new Uint8Array(memory, address, length);
  }

  text(pointer, length) {
    if (!Number.isInteger(length) || length < 0 || length > MAX_TEXT) throw new Error('The game returned an oversized text message.');
    return decoder.decode(this.range(pointer, length));
  }

  error(fallback) {
    return this.text(this.api.error_ptr(), this.api.error_len()) || fallback;
  }

  check(result, fallback) {
    if (result !== 1) throw new Error(this.error(fallback));
  }

  snapshot() {
    const api = this.api;
    if (!api) throw new Error('No game is running.');
    const width = api.game_frame_width(), height = api.game_frame_height();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048) {
      throw new Error('The game returned an invalid display size (maximum 2048 × 2048).');
    }
    // Copy before transferring to the page; never detach WebAssembly memory.
    const frame = this.range(api.game_frame_ptr(), width * height * 4).slice();
    const status = this.text(api.game_status_ptr(), api.game_status_len());
    const physicalKeyboard = typeof api.game_keyboard_mode === 'function' && api.game_keyboard_mode() === 1;
    const physicalKeyboardSupported=typeof api.game_keyboard_mode==='function';
    const improvementsSupported=this.improvementsSupported;
    const improvedMode=improvementsSupported&&api.game_improved_mode()===1;
    let ui=null;
    if(typeof api.game_ui_len==='function'&&api.game_ui_len()){
      try{ui=validatePanel(JSON.parse(this.text(api.game_ui_ptr(),api.game_ui_len())));}
      catch(error){throw new Error(`Game controls could not be read: ${error.message}`);}
    }
    return {width, height, frame, status, physicalKeyboard,physicalKeyboardSupported,improvementsSupported,improvedMode,ui};
  }

  input(kind, a, b) {
    return this.inputs([{kind, a, b}]);
  }

  inputs(events) {
    if (!this.api) throw new Error('No game is running.');
    if (!Array.isArray(events) || events.length > 32) throw new Error('Invalid input batch.');
    for (const event of events) {
      if(event.uiAction){this.uiAction(event.uiAction);continue;}
      if(typeof event.improvedMode==='boolean'){this.setImprovedMode(event.improvedMode);continue;}
      if(event.keyboard){this.keyboardInput(event);continue;}
      const {kind,a,b}=event;
      if (kind === 10) {
        if (this.pointerMotion) this.check(this.api.game_pointer_move(a, b), 'Pointer motion failed.');
      } else this.check(this.api.game_input(kind, a, b), 'Game input failed.');
    }
    return this.snapshot();
  }

  keyboardInput({usage,pressed,fallback}) {
    // Decide in the worker after all earlier inputs and file replies. A page
    // snapshot can still describe the menu that the preceding key just left.
    const previous=this.keyboardDown.get(usage);
    if(!pressed){
      this.keyboardDown.delete(usage);
      if(previous===true)this.check(this.api.game_input(12,usage,0),'Game input failed.');
      return;
    }
    const physical=typeof this.api.game_keyboard_mode==='function'&&this.api.game_keyboard_mode()===1;
    if(previous===true)return; // Raw keys never autorepeat into a new text field.
    if(previous===undefined){
      this.keyboardDown.set(usage,physical);
      if(physical){this.check(this.api.game_input(12,usage,1),'Game input failed.');return;}
    }
    if(!physical&&fallback)this.check(this.api.game_input(fallback.kind,fallback.a,fallback.b),'Game input failed.');
  }

  tick(milliseconds) {
    if (typeof this.api?.game_tick === 'function') this.check(this.api.game_tick(milliseconds), 'Game update failed.');
    return this.snapshot();
  }

  get animated() { return typeof this.api?.game_tick === 'function'; }
  uiAction({id,revision,value=''}) {
    if(typeof this.api?.game_ui_action!=='function')throw new Error('This game does not supply contextual controls.');
    if(!Number.isInteger(id)||id<0||id>0xffffffff||!Number.isInteger(revision)||revision<0||revision>0xffffffff||typeof value!=='string')throw new Error('Invalid game action.');
    const bytes=new TextEncoder().encode(value);
    if(bytes.length>1024)throw new Error('Game input is too long.');
    const pointer=this.api.input_resize(bytes.length);
    if(!pointer&&bytes.length)throw new Error('Could not allocate game input.');
    this.range(pointer,bytes.length).set(bytes);
    const result=this.api.game_ui_action(id,revision);
    if(result!==2)this.check(result,'Game action failed.');
  }
  get improvementsSupported() { return ['game_improved_mode','game_set_improved_mode'].every(name=>typeof this.api?.[name]==='function'); }
  setImprovedMode(enabled) {
    if(typeof enabled!=='boolean')throw new Error('Choose Original or Improved mode.');
    if(!this.improvementsSupported)throw new Error('This build does not provide optional improvements.');
    this.check(this.api.game_set_improved_mode(Number(enabled)),'Could not change game mode.');
  }
  get pointerMotion() { return typeof this.api?.game_pointer_move === 'function'; }
  get audioSupported() { return AUDIO.every(name=>typeof this.api?.[name]==='function'); }
  configureAudio(rate) {
    if(!this.audioSupported){
      if(AUDIO.some(name=>typeof this.api?.[name]==='function'))throw new Error('The game has an incomplete audio interface.');
      return false;
    }
    if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new Error('Unsupported audio sample rate.');
    this.check(this.api.game_audio_configure(rate),'Game audio could not start.');
    this.audioRate=rate;
    return true;
  }
  audio(frames) {
    if(!this.audioRate)throw new Error('Game audio is not configured.');
    if(!Number.isInteger(frames)||frames<1||frames>8192)throw new Error('Invalid audio block size (1–8192 stereo frames).');
    this.check(this.api.game_audio_render(frames),'Game audio rendering failed.');
    if(this.api.game_audio_len()!==frames*4)throw new Error('The game returned an invalid audio buffer length.');
    return this.range(this.api.game_audio_ptr(),frames*4).slice();
  }
}
