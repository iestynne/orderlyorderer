// Towers of Scale .sav files: a table of save name -> record, each record
// holding a zlib-compressed undo history. SAVE_FORMAT.md §2-§3.
//
// Pure: bytes in, structure out. No filesystem access (D7).

import { inflateSync, deflateSync } from "node:zlib";
import {
  LuaArray,
  SavFormatError,
  bytesToString,
  emitTop,
  parseTop,
  stringToBytes,
  type LuaTable,
  type LuaValue,
} from "./buffer";

const MAGIC = "TOSSAVE\0";

/** One recorded transition. Usually (floor, x, y); orb moves in 3-1 add two more. */
export type Entry = number[];

export interface SaveRecord {
  name: string;
  /** ISO-ish "YYYY-MM-DD HH:MM", or null for the older bare-blob shape. */
  time: string | null;
  /**
   * Key order as found. A writer must reproduce it: both "time" then "data"
   * and "data" then "time" occur in shipped files (SAVE_FORMAT.md §2).
   */
  keyOrder: string[] | null;
  entries: Entry[];
}

export interface SaveFile {
  records: SaveRecord[];
}

function asBytes(v: LuaValue, what: string): Uint8Array {
  if (!(v instanceof Uint8Array)) throw new SavFormatError(`${what} is not a string`);
  return v;
}

function decodeBlob(blob: Uint8Array): Entry[] {
  const head = bytesToString(blob.subarray(0, 8));
  if (head !== MAGIC) {
    throw new SavFormatError(`blob does not start with TOSSAVE\0 (got ${JSON.stringify(head)})`);
  }
  const raw = new Uint8Array(inflateSync(blob.subarray(8)));
  const outer = parseTop(raw);
  if (!(outer instanceof LuaArray)) throw new SavFormatError("payload is not an array");
  return outer.map((e, i) => {
    if (!(e instanceof LuaArray)) throw new SavFormatError(`payload entry ${i} is not an array`);
    return e.map((n) => {
      if (typeof n !== "number") throw new SavFormatError(`payload entry ${i} holds a non-number`);
      if (!Number.isInteger(n)) throw new SavFormatError(`payload entry ${i} holds a non-integer ${n}`);
      return n;
    });
  });
}

/**
 * A record's decompressed payload — the bytes under the zlib stream, not the
 * stream itself.
 *
 * `[F]` SPEC-006 §5.1: the payload round trip is exact for all 326 records
 * while the compressed stream is not (§6), so this is the level at which two
 * routes may be compared byte for byte. SPEC-008 hashes it for `SaveSource`
 * and exports at it.
 */
export function emitPayload(entries: Entry[]): Uint8Array {
  return emitTop(LuaArray.from(entries.map((e) => LuaArray.from(e as LuaValue[]))));
}

export function parseSaveFile(bytes: Uint8Array): SaveFile {
  const top = parseTop(bytes);
  if (!(top instanceof Map)) throw new SavFormatError("top level is not a table");

  const records: SaveRecord[] = [];
  for (const [name, value] of top as LuaTable) {
    if (value instanceof Uint8Array) {
      // Shape A: a bare blob, no timestamp. Older game versions; never migrated.
      records.push({ name, time: null, keyOrder: null, entries: decodeBlob(value) });
      continue;
    }
    if (value instanceof Map) {
      // Shape B: { time, data } in either order.
      const keyOrder = [...value.keys()];
      const data = value.get("data");
      const time = value.get("time");
      if (data === undefined) throw new SavFormatError(`record ${JSON.stringify(name)} has no "data" key`);
      records.push({
        name,
        time: time === undefined ? null : bytesToString(asBytes(time, "time")),
        keyOrder,
        entries: decodeBlob(asBytes(data, "data")),
      });
      continue;
    }
    throw new SavFormatError(`record ${JSON.stringify(name)} is neither a blob nor a table`);
  }
  return { records };
}

/**
 * Byte-exact re-emission. zlib level 6 with the default strategy reproduces the
 * game's own streams; SPEC-006 §5 makes that a tested claim rather than an
 * assumption, since it depends on the compressor and not on this format.
 */
export function emitSaveFile(file: SaveFile): Uint8Array {
  const top: LuaTable = new Map();
  for (const rec of file.records) {
    const compressed = new Uint8Array(deflateSync(emitPayload(rec.entries), { level: 6 }));
    const full = new Uint8Array(8 + compressed.length);
    full.set(stringToBytes(MAGIC));
    full.set(compressed, 8);

    if (rec.keyOrder === null) {
      top.set(rec.name, full);
      continue;
    }
    const inner: LuaTable = new Map();
    for (const k of rec.keyOrder) {
      if (k === "data") inner.set("data", full);
      else if (k === "time") inner.set("time", stringToBytes(rec.time ?? ""));
      else throw new SavFormatError(`unexpected record key ${JSON.stringify(k)}`);
    }
    top.set(rec.name, inner);
  }
  return emitTop(top);
}
