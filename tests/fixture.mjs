// Authors: Christian Reitwiessner
// Minimal deterministic WebAssembly modules; no compiler/dependencies/assets.
const leb = value => { const out=[]; do { const byte=value&127; value>>>=7; out.push(byte|(value?128:0)); } while(value); return out; };
const signed = value => { const out=[]; let more=true; while(more){let byte=value&127;value>>=7;more=!((value===0&&!(byte&64))||(value===-1&&(byte&64)));out.push(byte|(more?128:0));}return out; };
const str = text => {const bytes=[...new TextEncoder().encode(text)];return [...leb(bytes.length),...bytes];};
const section=(id,bytes)=>[id,...leb(bytes.length),...bytes];
const vector=items=>[...leb(items.length),...items.flat()];
const constant=value=>[0x41,...signed(value)];

export function fixture(options={}) {
  const {version=1,width=2,height=1,pointer=32,missing='',badStart=false,hang=false,grow=false,tick=false,motion=false,imports=false}=options;
  const types=[[0x60,0,1,0x7f],[0x60,1,0x7f,1,0x7f],[0x60,3,0x7f,0x7f,0x7f,1,0x7f],[0x60,2,0x7f,0x7f,1,0x7f]];
  const definitions=[
    ['game_abi_version',0,constant(version)],['input_resize',1,constant(4096)],
    ['game_load',0,constant(1)],
    ['game_start',0,hang?[0x03,0x40,0x0c,0,0x0b,...constant(1)]:[...(grow?[...constant(1),0x40,0,0x1a]:[]),...constant(badStart?0:1)]],
    ['game_input',2,[...constant(32),0x20,0,0x3a,0,0,...constant(33),0x20,1,0x3a,0,0,...constant(1)]],
    ['game_frame_width',0,constant(width)],['game_frame_height',0,constant(height)],['game_frame_ptr',0,constant(pointer)],
    ['game_status_ptr',0,constant(128)],['game_status_len',0,constant(5)],
    ['error_ptr',0,constant(256)],['error_len',0,constant(12)],
    ...(tick?[['game_tick',1,constant(1)]]:[]),
    ...(motion?[['game_pointer_move',3,[...constant(34),0x20,0,0x3a,0,0,...constant(1)]]]:[])
  ];
  const importCount=imports?1:0;
  const exports=definitions.flatMap(([name],index)=>name===missing?[]:[[...str(name),0,...leb(index+importCount)]]);
  exports.push([...str('memory'),2,0]);
  const segments=[[32,[0,11,12,255,100,101,102,255]],[128,[...new TextEncoder().encode('Ready')]],[256,[...new TextEncoder().encode('test failure')]]];
  const bodies=definitions.map(([, ,code])=>{const body=[0,...code,0x0b];return [...leb(body.length),...body];});
  return new Uint8Array([0,97,115,109,1,0,0,0,
    ...section(1,vector(types)),
    ...(imports?section(2,vector([[...str('env'),...str('external'),0,0]])):[]),
    ...section(3,vector(definitions.map(([,type])=>leb(type)))),
    ...section(5,[1,0,1]),
    ...section(7,vector(exports)),...section(10,vector(bodies)),
    ...section(11,vector(segments.map(([offset,bytes])=>[0,...constant(offset),0x0b,...leb(bytes.length),...bytes])))
  ]);
}
