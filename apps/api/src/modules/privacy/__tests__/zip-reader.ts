import { inflateRawSync } from 'node:zlib';

/** File names and texts inside a ZIP (local headers in order; enough for our own files). */
export function unzipNames(zip: Uint8Array): Map<string, string> {
  const buffer = Buffer.from(zip);
  const files = new Map<string, string>();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength;
    files.set(name, inflateRawSync(buffer.subarray(start, start + size)).toString('utf8'));
    at = start + size;
  }
  return files;
}
