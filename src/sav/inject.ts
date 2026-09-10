// Add one record to a game-written `.sav`, leaving every other record's bytes
// exactly as the game wrote them.
//
// `[D]` This works on the container, never on `SaveFile`. `parseSaveFile`
// decompresses every record and `emitSaveFile` re-deflates every record, and
// Node's zlib reproduces only 82 of the game's 326 streams (SPEC-006 §6) — so
// a round trip through those two rewrites most of a player's file. Here the
// untouched records are carried across as the `LuaValue`s they parsed to and
// never decoded at all, which makes "we changed one record" a structural fact
// rather than a claim. A before/after diff is one contiguous span.
//
// Pure: bytes in, bytes out. No filesystem access (D7).

import { SavFormatError, emitTop, parseTop, stringToBytes, type LuaTable } from "./buffer";
import { emitBlob, type Deflate, type Entry } from "./savefile";

/** Refused before anything is written. Never thrown after a partial change. */
export class InjectRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InjectRefused";
  }
}

/**
 * `[F]` The game's own name entry (`save_manager.lua:327-352`) accepts at most
 * 24 of exactly these, and nothing else. A colon is deliberately absent, which
 * is what makes the `ORD:` prefix a namespace no hand-typed save can enter.
 */
export const GAME_NAME_CHARS = /^[A-Za-z0-9 !#$%&'()+\-@[\]^_`{}~.]*$/;
export const GAME_NAME_MAX = 24;

/** `[F]` Lua's `os.date` with no `!` is local time, so a game row reads local. */
export function localStamp(at = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
}

/**
 * `savBytes` with `name` added as a new record. The file is the player's own,
 * read moments earlier; it is parsed only to reach the top-level table.
 *
 * `[D]` **Refuses a name already in the file.** The top level is name -> record,
 * so a repeat name is a silent replacement — the one way this could destroy a
 * route. `[F]` The game guards the same case with its overwrite prompt
 * (`save_manager.lua:440-451`); we have no player to prompt, so we refuse.
 *
 * `[D]` The new record is appended last, so it is the only entry after every
 * existing one. `[F]` The save menu sorts by name (`reload_saves`), so file
 * order is ours to choose and never reaches the player.
 */
export function injectRecord(
  savBytes: Uint8Array,
  name: string,
  entries: Entry[],
  time = localStamp(),
  deflate?: Deflate,
): Uint8Array {
  const top = parseTop(savBytes);
  if (!(top instanceof Map)) throw new SavFormatError("top level is not a table");
  if (top.has(name)) {
    throw new InjectRefused(`${JSON.stringify(name)} is already a save in this file; injecting would replace it`);
  }
  const inner: LuaTable = new Map();
  inner.set("time", stringToBytes(time));
  inner.set("data", emitBlob(entries, deflate));
  (top as LuaTable).set(name, inner);
  return emitTop(top);
}

/**
 * `ORD:`-prefixed, inside the game's 24, and not a name `taken` already holds.
 *
 * `[F]` The prefix is settled: `EX-1.ORD-COLON` proved the game displays, sorts,
 * loads and deletes a colon it cannot type, so `ORD:` is a namespace no
 * hand-played save can enter. `[D]` A collision can therefore only be with an
 * earlier export, and a counter is enough to break it.
 */
export function ordName(base: string, taken: ReadonlySet<string>): string {
  const clean = [...base].filter((c) => GAME_NAME_CHARS.test(c)).join("").trim();
  const fit = (suffix: string): string => `ORD:${clean.slice(0, GAME_NAME_MAX - 4 - suffix.length).trim()}${suffix}`;
  if (!taken.has(fit(""))) return fit("");
  for (let n = 2; n < 1000; n++) {
    const candidate = fit(` ${n}`);
    if (!taken.has(candidate)) return candidate;
  }
  throw new InjectRefused(`no free name under "ORD:${clean}"; delete some in the game's savestate menu`);
}
