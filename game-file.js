// Authors: Christian Reitwiessner
// Read one Wasm module from a local file or an ordinary ZIP; no filesystem I/O.
const MAX_GAME = 64 * 1024 * 1024;
const decoder = new TextDecoder();
const crcTable = Array.from({length:256}, (_, value) => {
  for (let bit=0; bit<8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
const isWasm = bytes => bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109;

async function inflate(bytes, size) {
  let decompressor;
  try { decompressor = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('This browser cannot unpack compressed game ZIPs. Update your browser or select an uncompressed .wasm file.'); }
  const reader = new Blob([bytes]).stream().pipeThrough(decompressor).getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > size || length > MAX_GAME) throw new Error('Unpacked game exceeds its ZIP size or the 64 MiB limit.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function unpackGame(binary) {
  const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  if (bytes.length > MAX_GAME) throw new Error('Game file exceeds 64 MiB.');
  if (isWasm(bytes)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset, length) => {
    if (offset < 0 || length < 0 || offset > bytes.length || length > bytes.length-offset) throw new Error('Truncated game ZIP.');
    return bytes.subarray(offset, offset+length);
  };
  const word = offset => { range(offset,2); return view.getUint16(offset,true); };
  const long = offset => { range(offset,4); return view.getUint32(offset,true); };
  if (bytes.length < 4 || long(0) !== 0x04034b50) throw new Error('Choose a compiled .wasm game or a ZIP containing one. Native desktop and Amiga executables cannot run here.');
  let end = -1;
  for (let offset=bytes.length-22; offset>=Math.max(0,bytes.length-65557); offset--) {
    if (long(offset) === 0x06054b50 && offset+22+word(offset+20) === bytes.length) { end=offset; break; }
  }
  if (end < 0) throw new Error('Game ZIP has no valid central directory.');
  const count = word(end+10), directory = long(end+16), directorySize = long(end+12);
  if (word(end+4) !== 0 || word(end+6) !== 0 || word(end+8) !== count || count === 0xffff || count > 4096 || directory === 0xffffffff || directorySize === 0xffffffff) {
    throw new Error('Split, ZIP64 or oversized ZIP directories are not supported.');
  }
  if (directory+directorySize !== end) throw new Error('Invalid game ZIP directory bounds.');
  const candidates=[]; let offset=directory;
  for (let index=0; index<count; index++) {
    range(offset,46);
    if (long(offset) !== 0x02014b50) throw new Error('Invalid game ZIP directory entry.');
    const nameLength=word(offset+28), extraLength=word(offset+30), commentLength=word(offset+32);
    const next=offset+46+nameLength+extraLength+commentLength;
    if (next > end) throw new Error('Game ZIP entry exceeds its directory.');
    const name=decoder.decode(range(offset+46,nameLength)).replaceAll('\\','/');
    // macOS resource-fork sidecars are not alternative game modules.
    if (/\.wasm$/i.test(name) && !name.split('/').includes('__MACOSX') && !name.split('/').at(-1).startsWith('._')) {
      candidates.push({nameBytes:range(offset+46,nameLength), flags:word(offset+8), method:word(offset+10), crc:long(offset+16),
        packed:long(offset+20), size:long(offset+24), local:long(offset+42), disk:word(offset+34)});
    }
    offset=next;
  }
  if (offset !== end) throw new Error('Game ZIP directory size does not match its entries.');
  if (candidates.length !== 1) throw new Error(candidates.length ? 'This ZIP contains multiple .wasm games. Choose a ZIP containing only the game you want to run.' : 'This ZIP contains no .wasm game. Select the game-build ZIP as Game, and the original data ZIP as Data.');
  const entry=candidates[0];
  if (entry.flags & 0x41) throw new Error('Encrypted game ZIPs are not supported.');
  if (entry.disk !== 0 || entry.local === 0xffffffff || entry.packed === 0xffffffff || entry.size > MAX_GAME) throw new Error('ZIP game exceeds supported size or disk limits.');
  range(entry.local,30);
  if (long(entry.local) !== 0x04034b50 || word(entry.local+6) !== entry.flags || word(entry.local+8) !== entry.method) throw new Error('Inconsistent game ZIP headers.');
  const nameLength=word(entry.local+26), extraLength=word(entry.local+28);
  const localName=range(entry.local+30,nameLength);
  if (localName.length !== entry.nameBytes.length || !localName.every((byte,index)=>byte===entry.nameBytes[index])) throw new Error('Inconsistent ZIP game filename.');
  if (!(entry.flags & 8) && (long(entry.local+14) !== entry.crc || long(entry.local+18) !== entry.packed || long(entry.local+22) !== entry.size)) throw new Error('Inconsistent game ZIP sizes or checksum.');
  const start=entry.local+30+nameLength+extraLength;
  if (start+entry.packed > directory) throw new Error('ZIP game data overlaps the directory.');
  const packed=range(start,entry.packed);
  let result;
  if (entry.method === 0) result=packed;
  else if (entry.method === 8) result=await inflate(packed,entry.size);
  else throw new Error('This ZIP uses an unsupported compression method. Use a standard stored or deflated ZIP.');
  if (result.length !== entry.size || crc32(result) !== entry.crc) throw new Error('Game ZIP checksum or unpacked size does not match. Download the build again.');
  if (!isWasm(result)) throw new Error('The .wasm file inside this ZIP is not a WebAssembly binary.');
  return result;
}
