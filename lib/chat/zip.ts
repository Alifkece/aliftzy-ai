/** Minimal, dependency-free ZIP writer (store) and a verifier that reads the archive back. Pure: testable in Node. */
import { exclusionReason, normalizePath } from "./file-protocol";

export interface ZipInput {
  path: string;
  content: string;
}

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipPlan {
  entries: ZipInput[];
  /** Files left out on purpose (secrets, build artifacts) with the reason. */
  excluded: { path: string; reason: string }[];
  /** Case-insensitive collisions that were renamed so extraction on Windows/macOS cannot overwrite a file. */
  renamed: { from: string; to: string }[];
}

/** Decides what goes into the archive: safe paths, no excluded files, unique even case-insensitively. */
export function planZip(files: ZipInput[]): ZipPlan {
  const entries: ZipInput[] = [];
  const excluded: ZipPlan["excluded"] = [];
  const renamed: ZipPlan["renamed"] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const path = normalizePath(f.path);
    if (!path) continue;
    const reason = exclusionReason(path);
    if (reason) {
      excluded.push({ path, reason });
      continue;
    }
    let unique = path;
    for (let i = 2; seen.has(unique.toLowerCase()); i += 1) {
      const dot = path.lastIndexOf(".");
      const slash = path.lastIndexOf("/");
      unique = dot > slash + 1 ? `${path.slice(0, dot)}-${i}${path.slice(dot)}` : `${path}-${i}`;
    }
    if (unique !== path) renamed.push({ from: path, to: unique });
    seen.add(unique.toLowerCase());
    entries.push({ path: unique, content: f.content });
  }
  return { entries, excluded, renamed };
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(1980, d.getFullYear()) - 1980) << 9 | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function buildZipBytes(files: ZipInput[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.content);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, (3 << 8) | 20, true); // made by: Unix
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(38, (0o100644 << 16) >>> 0, true); // regular file, rw-r--r--
    entry.setUint32(42, offset, true);
    const bytes = new Uint8Array(46 + name.length);
    bytes.set(new Uint8Array(entry.buffer), 0);
    bytes.set(name, 46);
    central.push(bytes);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export interface ZipReadResult {
  ok: boolean;
  error?: string;
  entries: { path: string; size: number; content: string }[];
}

/** Reads the archive back (central directory + local headers + CRC) so a broken ZIP is never offered. */
export function readZipBytes(bytes: Uint8Array): ZipReadResult {
  const fail = (error: string): ZipReadResult => ({ ok: false, error, entries: [] });
  if (bytes.length < 22) return fail("Archive is too small.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail("End of central directory not found.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipReadResult["entries"] = [];
  try {
    for (let n = 0; n < count; n += 1) {
      if (v.getUint32(p, true) !== 0x02014b50) return fail("Corrupt central directory.");
      const method = v.getUint16(p + 10, true);
      const crc = v.getUint32(p + 16, true);
      const size = v.getUint32(p + 24, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const localAt = v.getUint32(p + 42, true);
      const path = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (method !== 0) return fail(`Unsupported compression for ${path}.`);
      if (v.getUint32(localAt, true) !== 0x04034b50) return fail(`Bad local header for ${path}.`);
      const lNameLen = v.getUint16(localAt + 26, true);
      const lExtraLen = v.getUint16(localAt + 28, true);
      const dataAt = localAt + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(dataAt, dataAt + size);
      if (data.length !== size) return fail(`Truncated data for ${path}.`);
      if (crc32(data) !== crc) return fail(`Checksum mismatch for ${path}.`);
      entries.push({ path, size, content: dec.decode(data) });
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch {
    return fail("Archive could not be read back.");
  }
  return { ok: true, entries };
}

/** Builds the archive and proves it is readable and identical to the input before returning it. */
export function buildVerifiedZip(files: ZipInput[]): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  if (files.length === 0) return { ok: false, error: "There are no files to put in the ZIP." };
  const bytes = buildZipBytes(files);
  const back = readZipBytes(bytes);
  if (!back.ok) return { ok: false, error: back.error ?? "ZIP verification failed." };
  if (back.entries.length !== files.length) return { ok: false, error: "ZIP verification failed: file count differs." };
  for (let i = 0; i < files.length; i += 1) {
    if (back.entries[i].path !== files[i].path || back.entries[i].content !== files[i].content) {
      return { ok: false, error: `ZIP verification failed for ${files[i].path}.` };
    }
  }
  return { ok: true, bytes };
}
