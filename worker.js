// Authors: Christian Reitwiessner
import { GameRuntime } from './runtime.js';
const runtime = new GameRuntime();
self.onmessage = async ({data: message}) => {
  try {
    let snapshot;
    if (message.type === 'load') snapshot = await runtime.load(message.binary, message.data);
    else if (message.type === 'input') snapshot = runtime.input(message.kind, message.a, message.b);
    else if (message.type === 'inputs') snapshot = runtime.inputs(message.events);
    else if (message.type === 'tick') snapshot = runtime.tick(message.milliseconds);
    else throw new Error('Unknown host request.');
    self.postMessage({id: message.id, ...snapshot, animated: runtime.animated, pointerMotion: runtime.pointerMotion}, [snapshot.frame.buffer]);
  } catch (error) {
    self.postMessage({id: message.id, error: error.message || String(error)});
  }
};
