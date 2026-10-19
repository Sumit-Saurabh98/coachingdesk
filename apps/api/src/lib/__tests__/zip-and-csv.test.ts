import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../csv';
import { ZipWriter } from '../zip-writer';

/**
 * A minimal reader, written from the spec independently of the writer: start at the END
 * record, walk the central directory, then each local header. That's how unzip tools read.
 */
function readZip(zip: Buffer): Map<string, { text: string; date: number; time: number }> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, { text: string; date: number; time: number }>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize));
    expect(crc32(data)).toBe(crc);
    files.set(name, {
      text: data.toString('utf8'),
      time: zip.readUInt16LE(at + 12),
      date: zip.readUInt16LE(at + 14),
    });
    at += 46 + nameLength;
  }
  return files;
}

describe('ZipWriter', () => {
  it('round-trips several files (UTF-8 names and content), CRCs check out', () => {
    const zip = new ZipWriter(new Date('2026-10-20T10:31:44Z'));
    zip.add('students.csv', 'name\r\nआरव शर्मा\r\n');
    zip.add('empty.csv', '');
    zip.add('बैच.csv', 'x'.repeat(100_000)); // compresses well

    const buffer = zip.toBuffer();
    const files = readZip(buffer);

    expect([...files.keys()]).toEqual(['students.csv', 'empty.csv', 'बैच.csv']);
    expect(files.get('students.csv')?.text).toBe('name\r\nआरव शर्मा\r\n');
    expect(files.get('empty.csv')?.text).toBe('');
    expect(files.get('बैच.csv')?.text).toHaveLength(100_000);
    expect(buffer.length).toBeLessThan(2_000);
  });

  it('stores the DOS date and time (2-second precision)', () => {
    const zip = new ZipWriter(new Date('2026-10-20T10:31:45Z'));
    zip.add('a.txt', 'a');
    const file = readZip(zip.toBuffer()).get('a.txt');
    expect(file?.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 20);
    expect(file?.time).toBe((10 << 11) | (31 << 5) | 22);
  });

  it('an empty archive is still a valid zip', () => {
    expect(readZip(new ZipWriter(new Date()).toBuffer()).size).toBe(0);
  });
});

describe('toCsv', () => {
  const body = (csv: string) => csv.slice(1); // without the BOM

  it('starts with a UTF-8 BOM and ends lines with CRLF', () => {
    const csv = toCsv(['a', 'b'], [[1, 'x']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(body(csv)).toBe('a,b\r\n1,x\r\n');
  });

  it('quotes commas, quotes and newlines; empty for null', () => {
    expect(body(toCsv(['v'], [['a,b'], ['say "hi"'], ['line\nbreak'], [null], [undefined]]))).toBe(
      'v\r\n"a,b"\r\n"say ""hi"""\r\n"line\nbreak"\r\n\r\n\r\n',
    );
  });

  it('defuses formulas in TEXT cells; numbers stay numbers', () => {
    const csv = body(
      toCsv(['v'], [['=HYPERLINK("x")'], ['+919876543210'], ['-1'], ['@SUM(A1)'], [-1], [true]]),
    );
    expect(csv.split('\r\n')).toEqual([
      'v',
      `"'=HYPERLINK(""x"")"`,
      "'+919876543210",
      "'-1",
      "'@SUM(A1)",
      '-1',
      'true',
      '',
    ]);
  });
});
