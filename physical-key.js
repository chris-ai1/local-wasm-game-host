// Authors: Christian Reitwiessner
// USB HID keyboard usage IDs; this helper contains no game-specific key map.
export function keyboardUsage(code) {
  if(/^Key[A-Z]$/.test(code))return 4+code.charCodeAt(3)-65;
  if(/^Digit[1-9]$/.test(code))return 30+Number(code[5])-1;
  if(/^F([1-9]|1[0-2])$/.test(code))return 58+Number(code.slice(1))-1;
  if(/^Numpad[1-9]$/.test(code))return 89+Number(code[6])-1;
  return {Digit0:39,Enter:40,Escape:41,Backspace:42,Tab:43,Space:44,Minus:45,Equal:46,
    BracketLeft:47,BracketRight:48,Backslash:49,IntlHash:50,Semicolon:51,Quote:52,Backquote:53,
    Comma:54,Period:55,Slash:56,CapsLock:57,PrintScreen:70,ScrollLock:71,Pause:72,
    Insert:73,Home:74,PageUp:75,Delete:76,End:77,PageDown:78,ArrowRight:79,ArrowLeft:80,
    ArrowDown:81,ArrowUp:82,NumLock:83,NumpadDivide:84,NumpadMultiply:85,NumpadSubtract:86,
    NumpadAdd:87,NumpadEnter:88,Numpad0:98,NumpadDecimal:99,IntlBackslash:100,Help:117,
    ControlLeft:224,ShiftLeft:225,AltLeft:226,MetaLeft:227,ControlRight:228,ShiftRight:229,
    AltRight:230,MetaRight:231}[code];
}

export function logicalKey(event) {
  if(!event||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return null;
  const kind={Enter:2,Backspace:3,Escape:4,ArrowLeft:8,ArrowRight:9}[event.key];
  if(kind)return {kind,a:0,b:0};
  return [...event.key].length===1?{kind:1,a:event.key.codePointAt(0),b:0}:null;
}

export function physicalKeyboard(element,{enabled,send,repeats=false}) {
  const pending=new Set();
  element.addEventListener('keydown',event=>{
    const usage=keyboardUsage(event.code);
    if(!enabled()||usage===undefined)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!pending.has(usage)||repeats){pending.add(usage);send(usage,true,event);}
  },true);
  element.addEventListener('keyup',event=>{
    const usage=keyboardUsage(event.code);
    if(!pending.delete(usage))return;
    event.preventDefault();event.stopImmediatePropagation();send(usage,false);
  },true);
  element.addEventListener('blur',()=>{for(const usage of pending)send(usage,false);pending.clear();});
  return ()=>pending.clear();
}
