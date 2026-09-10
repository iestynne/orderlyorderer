// Injection's own oracle: what an injected file does to the player's bytes.
//
// `[D]` The claim under test is not "the file still parses" — `emitSaveFile`
// managed that while rewriting most of the player's records (SPEC-006 §6). It
// is that **nothing but the record count and the appended record changes**, and
// that is a byte claim, so it is asserted on bytes.

import { describe, expect, it } from "vitest";
import { GAME_NAME_CHARS, GAME_NAME_MAX, InjectRefused, injectRecord, localStamp } from "../../src/sav/inject";
import { emitBlob, emitPayload, parseSaveFile } from "../../src/sav/savefile";
import { haveSaves, loadAllSaves } from "./helpers";

const d = haveSaves ? describe : describe.skip;

d("injection into a game-written .sav", () => {
  it("changes one byte and appends; every original byte survives at its own offset", () => {
    const report: string[] = [];
    for (const { towerId, bytes, file } of loadAllSaves()) {
      const after = injectRecord(bytes, "ORD:probe", file.records[0]!.entries, "2026-09-09 18:30");

      // Byte 0 is the table tag; byte 1 is the record count, which must change.
      expect(after[0], `${towerId} tag`).toBe(bytes[0]);
      expect(after[1], `${towerId} count`).not.toBe(bytes[1]);

      // And from byte 2 the original is present verbatim, at the same offsets.
      expect(Buffer.from(after.subarray(2, bytes.length)).equals(Buffer.from(bytes.subarray(2))), `${towerId} tail`).toBe(true);
      report.push(`${towerId} +${after.length - bytes.length}`);
    }
    expect(report.length).toBe(14);
  });

  it("leaves every original record readable, in order, with the new one last", () => {
    for (const { towerId, bytes, file } of loadAllSaves()) {
      const re = parseSaveFile(injectRecord(bytes, "ORD:probe", file.records[0]!.entries));
      expect(re.records.length, towerId).toBe(file.records.length + 1);
      file.records.forEach((r, i) => {
        expect(re.records[i]!.name, `${towerId} #${i} name`).toBe(r.name);
        expect(re.records[i]!.entries, `${towerId} #${i} payload`).toEqual(r.entries);
      });
      expect(re.records[re.records.length - 1]!.name, towerId).toBe("ORD:probe");
    }
  });

  it("refuses a name the file already holds, rather than replacing it", () => {
    const { bytes, file } = loadAllSaves()[0]!;
    const taken = file.records[0]!.name;
    expect(() => injectRecord(bytes, taken, file.records[0]!.entries)).toThrow(InjectRefused);
  });
});

describe("the game's own name rules (save_manager.lua:327-352)", () => {
  it("admits what the game's keyboard admits", () => {
    expect(GAME_NAME_MAX).toBe(24);
    expect(GAME_NAME_CHARS.test("Route 2-5 [A] 98.3M win")).toBe(true);
    expect(GAME_NAME_CHARS.test("a!#$%&'()+-@[]^_`{}~.")).toBe(true);
  });

  it("excludes the colon, which is what reserves the ORD: namespace", () => {
    expect(GAME_NAME_CHARS.test("ORD:anything")).toBe(false);
    for (const c of [":", ",", "/", "\\", "<", ">", "?", "*", '"', "|", ";", "="]) {
      expect(GAME_NAME_CHARS.test(c), `${c} must be unreachable from the game`).toBe(false);
    }
  });
});

describe("timestamps", () => {
  it("are local, because Lua's os.date without ! is local (save_manager.lua:575)", () => {
    const at = new Date(2026, 8, 9, 18, 30);
    expect(localStamp(at)).toBe("2026-09-09 18:30");
    // The bug this replaces: toISOString() is UTC, so it disagrees whenever the
    // machine is not on UTC -- which is every game-written row beside it.
    expect(localStamp(at).length).toBe(16);
  });
});

// `[D]` The browser bundle aliases `node:zlib` to fflate (`zlib-browser.ts`), so
// the stream a player writes is not the stream any other test here exercises.
// This asserts the only property that matters: whatever fflate emits, a zlib
// decompressor reads back as the payload we handed it. Love2D decompresses with
// `love.data.decompress("string","zlib",...)` (`save_manager.lua:609`), which
// like Node's accepts any conformant stream regardless of who wrote it.
// `EX-1.ORD-FFLATE.sav` is the end-to-end half of the same claim.
d("fflate, the compressor that actually ships", () => {
  it("round-trips every corpus record through the browser's compressor", async () => {
    const { zlibSync } = await import("fflate");
    const { inflateSync } = await import("node:zlib");
    const fflate = (data: Uint8Array, opts: { level: number }): Uint8Array => zlibSync(data, { level: opts.level as 6 });

    let checked = 0;
    for (const { towerId, bytes, file } of loadAllSaves()) {
      for (const rec of file.records) {
        const blob = emitBlob(rec.entries, fflate);
        expect(Buffer.from(blob.subarray(0, 8)).toString("latin1"), `${towerId}/${rec.name} magic`).toBe("TOSSAVE\0");
        // A zlib wrapper, not raw DEFLATE -- fflate's own `deflateSync` would
        // emit the latter and the game would refuse it with no clue why.
        expect(blob[8]! & 0x0f, `${towerId}/${rec.name} CMF`).toBe(8);
        const back = new Uint8Array(inflateSync(Buffer.from(blob.subarray(8))));
        expect(Buffer.from(back).equals(Buffer.from(emitPayload(rec.entries))), `${towerId}/${rec.name}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(326);
  });
});
