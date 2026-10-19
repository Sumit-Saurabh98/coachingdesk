import { crc32, deflateRawSync } from 'node:zlib';

// ZIP format constants (PKWARE APPNOTE 6.3): no library needed for "a few files, deflated".
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const VERSION = 20; // 2.0: deflate
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_DEFLATE = 8;
const MAX_32_BIT = 0xffffffff;

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  compressed: Buffer;
  offset: number;
}

/**
 * Builds a .zip in memory. Small and dependency-free on purpose: exports are tens of MB at
 * most, and Node already has deflate and CRC-32. No ZIP64: refuses anything past 4 GB.
 */
export class ZipWriter {
  private readonly entries: Entry[] = [];
  private readonly chunks: Buffer[] = [];
  private offset = 0;
  private readonly dosTime: number;
  private readonly dosDate: number;

  /** `modifiedAt`: one timestamp for every file (from the Clock, so tests are deterministic). */
  constructor(modifiedAt: Date) {
    ({ time: this.dosTime, date: this.dosDate } = toDosDateTime(modifiedAt));
  }

  add(name: string, content: string | Uint8Array): void {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const entry: Entry = {
      name: nameBytes,
      crc: crc32(data),
      size: data.length,
      compressed,
      offset: this.offset,
    };
    if (data.length > MAX_32_BIT || this.offset + compressed.length > MAX_32_BIT) {
      throw new Error('ZipWriter: archive too large (ZIP64 is not supported)');
    }

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAG_UTF8_NAMES, 6);
    header.writeUInt16LE(METHOD_DEFLATE, 8);
    header.writeUInt16LE(this.dosTime, 10);
    header.writeUInt16LE(this.dosDate, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // no extra field
    this.push(header, nameBytes, compressed);
    this.entries.push(entry);
  }

  /** The finished archive: the files, then the central directory that lists them. */
  toBuffer(): Buffer {
    if (this.entries.length > 0xffff) {
      throw new Error('ZipWriter: too many files');
    }
    const directoryStart = this.offset;
    const directory: Buffer[] = [];
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL_HEADER, 0);
      header.writeUInt16LE(VERSION, 4); // made by
      header.writeUInt16LE(VERSION, 6); // needed to extract
      header.writeUInt16LE(FLAG_UTF8_NAMES, 8);
      header.writeUInt16LE(METHOD_DEFLATE, 10);
      header.writeUInt16LE(this.dosTime, 12);
      header.writeUInt16LE(this.dosDate, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed.length, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      // extra length, comment length, disk number, internal + external attributes: all 0
      header.writeUInt32LE(entry.offset, 42);
      directory.push(header, entry.name);
    }
    const directoryBytes = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(this.entries.length, 8); // entries on this disk
    end.writeUInt16LE(this.entries.length, 10); // entries in total
    end.writeUInt32LE(directoryBytes.length, 12);
    end.writeUInt32LE(directoryStart, 16);
    return Buffer.concat([...this.chunks, directoryBytes, end]);
  }

  private push(...buffers: Buffer[]): void {
    for (const buffer of buffers) {
      this.chunks.push(buffer);
      this.offset += buffer.length;
    }
  }
}

/** MS-DOS date/time (2-second precision, years 1980+), as ZIP stores it. Uses UTC. */
function toDosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}
