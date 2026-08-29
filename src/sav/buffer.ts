// LuaJIT string.buffer serialization — the subset Towers of Scale uses, plus
// loud rejection of every documented tag we have not seen.
//
// Authoritative spec: https://luajit.org/ext_buffer.html ("Serialization Format
// Specification"). SAVE_FORMAT.md §2 records which parts matter and why.
// This is a port of tools/luajit_buffer.py, which stays as the differential
// reference (SPEC-006 §5).

/** Values a .sav can hold. Strings stay as bytes: keys are ASCII, blobs are not. */
export type LuaValue = null | boolean | number | Uint8Array | LuaArray | LuaTable;
export class LuaArray extends Array<LuaValue> {}
/** Insertion-ordered, because a writer must reproduce key order exactly. */
export type LuaTable = Map<string, LuaValue>;

const MAX_U2 = 0x1fdf;

export class SavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavFormatError";
  }
}

/**
 * Prefix-encoded unsigned. The 0xFF lead byte is reserved for the 32-bit form,
 * so the two-byte form tops out at 8159 (0x1FDF), not 8415 — emitting 0xFF as
 * a two-byte lead produces data that decodes as a 32-bit length. That was a
 * real bug in the first implementation; SAVE_FORMAT.md §2 records it.
 */
export function encodeU(n: number): number[] {
  if (n <= 0xdf) return [n];
  if (n <= MAX_U2) {
    const d = n - 0xe0;
    return [0xe0 | ((d >> 8) & 0x1f), d & 0xff];
  }
  return [0xff, n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

export interface Reader {
  buf: Uint8Array;
  view: DataView;
  i: number;
}

export function reader(buf: Uint8Array): Reader {
  return { buf, view: new DataView(buf.buffer, buf.byteOffset, buf.byteLength), i: 0 };
}

export function decodeU(r: Reader): number {
  const c = need(r, 1);
  if (c <= 0xdf) {
    r.i += 1;
    return c;
  }
  if (c === 0xff) {
    need(r, 5);
    const n = r.view.getUint32(r.i + 1, true);
    r.i += 5;
    return n;
  }
  need(r, 2);
  const n = 0xe0 + ((c & 0x1f) << 8) + r.buf[r.i + 1]!;
  r.i += 2;
  return n;
}

function need(r: Reader, n: number): number {
  if (r.i + n > r.buf.length) {
    throw new SavFormatError(`truncated at byte ${r.i}: needed ${n} more, have ${r.buf.length - r.i}`);
  }
  return r.buf[r.i]!;
}

const REJECTED: Record<number, string> = {
  0x03: "reserved",
  0x04: "reserved",
  0x05: "reserved",
  0x0b: "0-based array with hash part",
  0x0d: "mixed table",
  0x0e: "metatable dict entry",
  0x0f: "string dict entry — the game passed a `dict` option to buffer.new; a naive parser silently misreads keys",
  0x12: "complex number",
};

export function parseValue(r: Reader): LuaValue {
  const t = need(r, 1);
  const at = r.i;

  if (t === 0x00) return (r.i += 1), null;
  if (t === 0x01) return (r.i += 1), false;
  if (t === 0x02) return (r.i += 1), true;
  if (t === 0x06) {
    need(r, 5);
    const v = r.view.getInt32(r.i + 1, true);
    r.i += 5;
    return v;
  }
  if (t === 0x07) {
    need(r, 9);
    const v = r.view.getFloat64(r.i + 1, true);
    r.i += 9;
    return v;
  }
  if (t === 0x08) return (r.i += 1), new Map<string, LuaValue>();
  if (t === 0x09) {
    r.i += 1;
    const n = decodeU(r);
    const out: LuaTable = new Map();
    for (let k = 0; k < n; k++) {
      const key = parseValue(r);
      if (!(key instanceof Uint8Array)) {
        throw new SavFormatError(`non-string table key at byte ${at}`);
      }
      out.set(bytesToString(key), parseValue(r));
    }
    return out;
  }
  if (t === 0x0a) {
    r.i += 1;
    const n = decodeU(r);
    const out = new LuaArray();
    for (let k = 0; k < n; k++) out.push(parseValue(r));
    return out;
  }
  if (t === 0x0c) {
    // 1-based array: the stored count is Lua's length plus one.
    r.i += 1;
    const n = decodeU(r);
    const out = new LuaArray();
    for (let k = 0; k < n - 1; k++) out.push(parseValue(r));
    return out;
  }
  if (t === 0x10 || t === 0x11) {
    need(r, 9);
    const v = t === 0x10 ? r.view.getBigInt64(r.i + 1, true) : r.view.getBigUint64(r.i + 1, true);
    r.i += 9;
    return Number(v);
  }
  if (REJECTED[t] !== undefined) {
    throw new SavFormatError(`LuaJIT tag 0x${t.toString(16).padStart(2, "0")} at byte ${at} (${REJECTED[t]}) — documented but unused by TOS; implement before trusting`);
  }
  if (t >= 0x20) {
    const n = decodeU(r);
    const len = n - 0x20;
    need(r, len);
    const s = r.buf.subarray(r.i, r.i + len);
    r.i += len;
    return s;
  }
  throw new SavFormatError(`unknown LuaJIT tag 0x${t.toString(16).padStart(2, "0")} at byte ${at}`);
}

export function emitValue(v: LuaValue, out: number[]): void {
  if (v === null) return void out.push(0x00);
  if (v === false) return void out.push(0x01);
  if (v === true) return void out.push(0x02);
  if (v instanceof Uint8Array) {
    out.push(...encodeU(v.length + 0x20));
    for (const b of v) out.push(b);
    return;
  }
  if (v instanceof LuaArray) {
    out.push(0x0c, ...encodeU(v.length + 1));
    for (const x of v) emitValue(x, out);
    return;
  }
  if (v instanceof Map) {
    if (v.size === 0) return void out.push(0x08);
    out.push(0x09, ...encodeU(v.size));
    for (const [k, x] of v) {
      emitValue(stringToBytes(k), out);
      emitValue(x, out);
    }
    return;
  }
  if (typeof v === "number") {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    out.push(0x07, ...b);
    return;
  }
  throw new SavFormatError(`cannot emit ${typeof v}`);
}

/** Latin-1, so every byte round-trips; save names and keys are ASCII in practice. */
export function bytesToString(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

export function stringToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export function parseTop(buf: Uint8Array): LuaValue {
  const r = reader(buf);
  const v = parseValue(r);
  if (r.i !== buf.length) {
    throw new SavFormatError(`trailing bytes: parsed ${r.i} of ${buf.length}`);
  }
  return v;
}

export function emitTop(v: LuaValue): Uint8Array {
  const out: number[] = [];
  emitValue(v, out);
  return Uint8Array.from(out);
}
