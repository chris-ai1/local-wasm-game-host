// Authors: Christian Reitwiessner
import {physicalKeyboard,logicalKey} from './physical-key.js';
import {AudioOutput} from './audio-output.js';
import {filePanel} from './file-panel.js';
const $ = selector => document.querySelector(selector);
const binary = $('#binary'), data = $('#data'), canvas = $('#screen');
const context = canvas.getContext('2d', {alpha: false});
const status = $('#status'), keyboard = $('#keyboard');
const MAX_BINARY = 64 * 1024 * 1024, MAX_DATA = 128 * 1024 * 1024;
let worker, epoch = 0, requestId = 0, running = false, busy = false, animation = 0, lastTick = 0;
let lastPointer = {x: 0, y: 0};
let inputQueue = [], inputBusy = false;
let pointerMotion = false;
let physicalKeyboardSupported = false;
let audio;
const resetPhysicalKeys=physicalKeyboard(canvas,{
  enabled:()=>running&&physicalKeyboardSupported,repeats:true,
  send:(usage,pressed,event)=>queueInput({keyboard:true,usage,pressed,fallback:pressed?logicalKey(event):null}),
});
const savedFiles=filePanel($('#local-files'),{
  list:async()=>(await request({type:'files-list'})).paths,
  importFile:async(path,bytes)=>request({type:'files-import',path,bytes},[bytes],20000),
  exportFile:async path=>(await request({type:'files-export',path})).bytes,
  focus:()=>canvas.focus(),
});
let fileRevision=0;
const pending = new Map();
const errorMessages = [];

function clearErrors() {
  errorMessages.length = 0;
  $('#error-details').textContent = '';
  $('#error-panel').hidden = true;
}

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
  // Keep diagnostics independently of subsequent status and file changes.
  if (error) {
    if (!errorMessages.includes(text)) errorMessages.push(text);
    $('#error-details').textContent = errorMessages.join('\n\n');
    $('#error-panel').hidden = false;
  }
}

function controls() {
  $('#start').disabled = !binary.files.length || busy;
  $('#stop').disabled = !worker && !busy;
  $('#fullscreen').disabled = !running || !document.fullscreenEnabled;
  $('#sound').disabled = !running || !audio || audio.stopped;
  $('#clear-data').disabled = !data.files.length;
  keyboard.disabled = !running;
  document.querySelectorAll('[data-key], #right-click').forEach(button => button.disabled = !running);
}

function stop(text = 'Stopped. Start creates a fresh game.') {
  epoch++;savedFiles.stop();fileRevision=0;
  running = false; busy = false;
  inputQueue = []; inputBusy = false;
  pointerMotion = false;
  physicalKeyboardSupported = false;
  resetPhysicalKeys();
  cancelAnimationFrame(animation);
  audio?.stop();audio=undefined;
  $('#sound').textContent='Mute sound';$('#sound').setAttribute('aria-pressed','false');
  worker?.terminate(); worker = undefined;
  for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(new Error('Game stopped.')); }
  pending.clear();
  canvas.hidden = true; $('#placeholder').hidden = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  keyboard.value = ''; lastPointer = {x: 0, y: 0};
  $('#session').textContent = 'Nothing running';
  message(text); controls();
}

function fail(error, activeEpoch) {
  if (activeEpoch !== epoch) return;
  stop(); message(error.message || String(error), true);
}

function request(payload, transfer = [], timeout = 3000) {
  if (!worker) return Promise.reject(new Error('No game is running.'));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The game stopped responding. Choose Start to try again.'));
    }, timeout);
    pending.set(id, {resolve, reject, timer});
    try { worker.postMessage({id, ...payload}, transfer); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

function render(snapshot) {
  if (canvas.width !== snapshot.width || canvas.height !== snapshot.height) {
    canvas.width = snapshot.width; canvas.height = snapshot.height;
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(snapshot.frame.buffer), snapshot.width, snapshot.height), 0, 0);
  canvas.hidden = false; $('#placeholder').hidden = true;
  message(snapshot.status || 'Game running.');
  if(snapshot.fileWarning)message(snapshot.fileWarning,true);
  if(snapshot.fileRevision!==undefined&&snapshot.fileRevision!==fileRevision){fileRevision=snapshot.fileRevision;savedFiles.refresh();}
}

async function animate(timestamp, activeEpoch) {
  if (!running || activeEpoch !== epoch) return;
  try {
    const elapsed = lastTick ? Math.min(100, Math.max(0, Math.round(timestamp - lastTick))) : 0;
    lastTick = timestamp;
    const frame = await request({type: 'tick', milliseconds: elapsed});
    if (activeEpoch !== epoch) return;
    render(frame);
    animation = requestAnimationFrame(time => animate(time, activeEpoch));
  } catch (error) { fail(error, activeEpoch); }
}

$('#start').addEventListener('click', async () => {
  stop();
  clearErrors();
  const activeEpoch = epoch, gameFile = binary.files[0], dataFile = data.files[0];
  if (!gameFile) return;
  busy = true; controls(); message('Opening local files…');
  let audioError;
  try {audio=new AudioOutput();}catch(error){audioError=error;}
  try {
    if (gameFile.size > MAX_BINARY) throw new Error('Game binary exceeds 64 MiB.');
    if (dataFile && dataFile.size > MAX_DATA) throw new Error('Game data exceeds 128 MiB.');
    const [gameBytes, dataBytes] = await Promise.all([gameFile.arrayBuffer(), dataFile ? dataFile.arrayBuffer() : null]);
    if (activeEpoch !== epoch) return;
    worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = ({data: reply}) => {
      const entry = pending.get(reply.id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(reply.id);
      if (reply.error) entry.reject(new Error(reply.error)); else entry.resolve(reply);
    };
    worker.onerror = event => fail(new Error(event.message || 'Game worker failed to start.'), activeEpoch);
    const transfers = dataBytes === null ? [gameBytes] : [gameBytes, dataBytes];
    const first = await request({type: 'load', binary: gameBytes, data: dataBytes}, transfers, 20000);
    if (activeEpoch !== epoch) return;
    running = true; busy = false; render(first); controls();
    pointerMotion = first.pointerMotion === true;
    physicalKeyboardSupported = first.physicalKeyboardSupported === true;
    if(first.fileSupported)savedFiles.start(first.fileDirectory);
    $('#session').textContent = gameFile.name;
    canvas.focus();
    if (first.animated) { lastTick = 0; animation = requestAnimationFrame(time => animate(time, activeEpoch)); }
    if(first.audioSupported&&audio){
      const current=audio;
      const audioFailed=error=>{if(activeEpoch===epoch){message(`Audio unavailable: ${error.message}. The game is still running.`,true);controls();}};
      current.start(async rate=>(await request({type:'audio-configure',rate})).supported,
        async frames=>(await request({type:'audio',frames})).pcm,audioFailed).catch(error=>{if(activeEpoch===epoch){current.stop();audioFailed(error);}});
    } else {
      audio?.stop();
      if(first.audioSupported&&audioError)message(`Audio unavailable: ${audioError.message}. The game is still running.`,true);
    }
    controls();
  } catch (error) { fail(error, activeEpoch); }
});

$('#stop').addEventListener('click', () => stop());
$('#sound').addEventListener('click',()=>{
  if(!audio||audio.stopped)return;
  const current=audio,activeEpoch=epoch;
  current.context.resume().catch(error=>{
    if(activeEpoch===epoch&&audio===current&&running)message(`Audio unavailable: ${error.message}. The game is still running.`,true);
  });
  audio.setMuted(!audio.muted);
  $('#sound').textContent=audio.muted?'Unmute sound':'Mute sound';
  $('#sound').setAttribute('aria-pressed',String(audio.muted));
  canvas.focus();
});
$('#dismiss-error').addEventListener('click', clearErrors);
$('#reload').addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.set('reload', Date.now().toString());
  location.replace(url);
});
$('#clear-data').addEventListener('click', () => {
  data.value = '';
  data.dispatchEvent(new Event('change'));
});
for (const [input, label] of [[binary, '#binary-name'], [data, '#data-name']]) {
  input.addEventListener('change', () => {
    stop('Local files selected. Choose Start when ready.');
    const file = input.files[0];
    $(label).textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KiB` : 'No file selected';
    controls();
  });
}

function send(kind, a = 0, b = 0) {
  queueInput({kind,a,b});
}

function queueInput(event) {
  if (!running) return;
  if (inputQueue.length >= 256) { fail(new Error('Too much queued input. Restart the game and enter text in smaller pieces.'), epoch); return; }
  inputQueue.push(event);
  if (!inputBusy) drainInput();
}

async function drainInput() {
  inputBusy = true;
  const activeEpoch = epoch;
  try {
    while (inputQueue.length && activeEpoch === epoch) {
      const snapshot = await request({type: 'inputs', events: inputQueue.splice(0, 32)});
      if (activeEpoch !== epoch) return;
      render(snapshot);
    }
  } catch (error) { fail(error, activeEpoch); }
  finally { if (activeEpoch === epoch) inputBusy = false; }
}

canvas.addEventListener('contextmenu', event => event.preventDefault());
function pointerPosition(event) {
  // Account for object-fit letterboxing, including in fullscreen.
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const x = Math.floor((event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) / scale);
  const y = Math.floor((event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) / scale);
  return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height ? {x, y} : null;
}
canvas.addEventListener('pointermove', event => {
  const point = pointerPosition(event);
  if (point) { lastPointer = point; if (pointerMotion) send(10, point.x, point.y); }
});
canvas.addEventListener('pointerup', event => {
  if (event.button !== 0 && event.button !== 2) return;
  const point = pointerPosition(event); if (!point) return;
  lastPointer = point; send(event.button === 2 ? 6 : 5, point.x, point.y); canvas.focus();
});
canvas.addEventListener('keydown', event => {
  const fallback=logicalKey(event);
  if(fallback){event.preventDefault();queueInput(fallback);}
});
keyboard.addEventListener('beforeinput', event => {
  if (event.inputType === 'deleteContentBackward') { event.preventDefault(); send(3); }
});
keyboard.addEventListener('input', event => {
  if (event.isComposing) return;
  const characters = [...keyboard.value];
  keyboard.value = '';
  if (characters.length > 256) { message('Enter up to 256 characters at a time.', true); return; }
  for (const character of characters) send(1, character.codePointAt(0));
});
keyboard.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); send(2); }
  if (event.key === 'Backspace' && !keyboard.value) { event.preventDefault(); send(3); }
});
document.querySelectorAll('[data-key]').forEach(button => button.addEventListener('click', () => send(Number(button.dataset.key), Number(button.dataset.value || 0))));
$('#right-click').addEventListener('click', () => send(6, lastPointer.x, lastPointer.y));
$('#fullscreen').addEventListener('click', async () => {
  try { await $('.cabinet').requestFullscreen(); canvas.focus(); }
  catch (error) { message(`Fullscreen unavailable: ${error.message}`, true); }
});
controls();
