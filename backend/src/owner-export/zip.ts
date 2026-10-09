import { crc32, deflateRawSync } from 'node:zlib';

// A plain ZIP archive (APPNOTE 6.3) of a few deflated files, enough for the CSV export
// (EXP-CSV): UTF-8 names, no directories, no ZIP64, so each file stays under 4 GiB.

export interface ZipFile {
  name: string;
  data: Buffer;
}

const MAX = 0xffffffff;
const safeName = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** MS-DOS time and date of a UTC instant, two-second resolution. */
function dosStamp(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

export function zipArchive(files: readonly ZipFile[], modifiedAt: Date): Buffer {
  const names = new Set<string>();
  const { time, date } = dosStamp(modifiedAt);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (!safeName.test(file.name) || names.has(file.name))
      throw new Error('Invalid or duplicate ZIP entry name');
    names.add(file.name);
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    if (file.data.length > MAX || compressed.length > MAX || offset > MAX)
      throw new Error('ZIP entry exceeds 4 GiB');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: deflate
    local.writeUInt16LE(0x0800, 6); // UTF-8 name
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  if (offset > MAX || files.length > 0xffff) throw new Error('ZIP archive exceeds its limits');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
