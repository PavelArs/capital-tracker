import { crc32, inflateRawSync } from 'node:zlib';
import { zipArchive } from './zip';

interface Entry {
  name: string;
  data: Buffer;
  crc: number;
  dosTime: number;
  dosDate: number;
}

/** Reads an archive through its central directory, as unzip and spreadsheet apps do. */
function readZip(archive: Buffer): Entry[] {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  const directoryOffset = archive.readUInt32LE(end + 16);
  expect(directoryOffset + archive.readUInt32LE(end + 12)).toBe(end);
  const entries: Entry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const method = archive.readUInt16LE(at + 10);
    const dosTime = archive.readUInt16LE(at + 12);
    const dosDate = archive.readUInt16LE(at + 14);
    const crc = archive.readUInt32LE(at + 16);
    const compressed = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const flags = archive.readUInt16LE(at + 8);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    expect(flags & 0x0800).toBe(0x0800);
    expect(method).toBe(8);
    expect(archive.readUInt32LE(local)).toBe(0x04034b50);
    expect(archive.readUInt32LE(local + 14)).toBe(crc);
    const localName = archive.readUInt16LE(local + 26);
    const start = local + 30 + localName + archive.readUInt16LE(local + 28);
    const data = inflateRawSync(archive.subarray(start, start + compressed));
    expect(data.length).toBe(size);
    entries.push({ name, data, crc, dosTime, dosDate });
    at += 46 + nameLength;
  }
  return entries;
}

describe('ZIP archive of the CSV export (EXP-CSV)', () => {
  const modifiedAt = new Date('2026-10-08T14:30:42.000Z');

  it('holds every file once, deflated, with its CRC-32 and the export time', () => {
    const files = [
      { name: 'assets.csv', data: Buffer.from('id,name\r\n1,Bitcoin\r\n') },
      { name: 'operations.csv', data: Buffer.from('a'.repeat(5000)) },
      { name: 'empty.csv', data: Buffer.alloc(0) },
    ];
    const entries = readZip(zipArchive(files, modifiedAt));
    expect(entries.map((entry) => entry.name)).toEqual([
      'assets.csv',
      'operations.csv',
      'empty.csv',
    ]);
    for (const [index, entry] of entries.entries()) {
      expect(entry.data.equals(files[index].data)).toBe(true);
      expect(entry.crc).toBe(crc32(files[index].data));
      // 14:30:42 UTC on 2026-10-08 in MS-DOS fields (two-second resolution).
      expect(entry.dosTime).toBe((14 << 11) | (30 << 5) | 21);
      expect(entry.dosDate).toBe(((2026 - 1980) << 9) | (10 << 5) | 8);
    }
  });

  it('is byte-for-byte the same for the same files and time', () => {
    const files = [{ name: 'wallets.csv', data: Buffer.from('id\r\n') }];
    expect(zipArchive(files, modifiedAt).equals(zipArchive(files, modifiedAt))).toBe(true);
  });

  it('refuses unsafe or duplicate names', () => {
    const data = Buffer.from('x');
    expect(() => zipArchive([{ name: '../evil.csv', data }], modifiedAt)).toThrow('ZIP entry');
    expect(() => zipArchive([{ name: '/abs.csv', data }], modifiedAt)).toThrow('ZIP entry');
    expect(() =>
      zipArchive(
        [
          { name: 'a.csv', data },
          { name: 'a.csv', data },
        ],
        modifiedAt,
      ),
    ).toThrow('ZIP entry');
  });
});
