// Authors: Christian Reitwiessner
import {deflateRawSync} from 'node:zlib';
import {crc32} from '../game-file.js';
export function zipFixture(entries, options={}) {
  const local=[], directory=[];let offset=0;
  for(const {name, bytes, method=8, flags=0} of entries){
    const filename=Buffer.from(name), source=Buffer.from(bytes);
    const packed=method===8?deflateRawSync(source):source, crc=crc32(source);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);
    header.writeUInt16LE(flags,6);header.writeUInt16LE(method,8);
    if(!(flags&8)){header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(source.length,22);}
    header.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);
    central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);
    central.writeUInt32LE(packed.length,20);central.writeUInt32LE(source.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    const descriptor=Buffer.alloc(flags&8?16:0);
    if(flags&8){descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(packed.length,8);descriptor.writeUInt32LE(source.length,12);}
    local.push(header,filename,packed,descriptor);directory.push(central,filename);
    offset+=header.length+filename.length+packed.length+descriptor.length;
  }
  const table=Buffer.concat(directory),comment=Buffer.from(options.comment||''),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(comment.length,20);
  return Buffer.concat([...local,table,end,comment]);
}
