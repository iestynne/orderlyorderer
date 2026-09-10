// Builds the probes the game has to answer (D16). Each asks one question that
// only the real loader can settle; the paired `.md` holds the question and the
// result. This file only makes the bytes, and makes them again if the question
// changes.
//
//   ./node_modules/.bin/tsx tools/sav/make-probe.ts

import { readFileSync, writeFileSync } from "node:fs";
import { zlibSync } from "fflate";
import { injectRecord } from "../../src/sav/inject";
import { parseSaveFile } from "../../src/sav/savefile";

const SRC = "data/saves/iestyn.2026.08.28/EX-1.sav";
const OUT = "data/saves/tests";
const STAMP = "2026-09-09 18:30";

const src = new Uint8Array(readFileSync(SRC));
const records = parseSaveFile(src).records;
const pick = (name: string): number[][] => records.find((r) => r.name === name)!.entries;

/** What `vite.config.ts` aliases `node:zlib` to for the browser bundle. */
const fflate = (data: Uint8Array, opts: { level: number }): Uint8Array =>
  zlibSync(data, { level: opts.level as 6 });

function write(test: string, build: (bytes: Uint8Array) => Uint8Array): void {
  const out = build(src);
  writeFileSync(`${OUT}/EX-1.${test}.sav`, out);
  const re = parseSaveFile(out);
  const added = re.records.slice(records.length);
  console.log(
    `EX-1.${test}.sav: ${re.records.length} records, ${out.length} bytes (+${out.length - src.length})\n` +
      added.map((r) => `  ${JSON.stringify(r.name)} — ${r.name.length} chars, ${r.entries.length} entries`).join("\n"),
  );
}

// ORD-COLON: can the game display and load a name its keyboard cannot type?
// `[F]` Answered 2026-09-09, all six checks. Regenerating must not change these
// bytes, or the recorded result stops describing the file.
write("ORD-COLON", (b) => {
  let out: Uint8Array = b;
  for (const name of ["ORD:probe", "ORD:78901234567890123456"]) {
    out = injectRecord(out, name, pick("AUTOSAVE_EXIT"), STAMP);
  }
  return out;
});

// ORD-FFLATE: can the game load a stream fflate compressed? Every save the game
// has accepted from us so far came from `tools/luajit_buffer.py`, whose zlib is
// byte-exact against Love2D's. The browser bundle uses neither that nor Node's.
// `[F]` A real 657-entry route, so the stream is long enough to exercise the
// compressor's block choices rather than one trivial literal run.
write("ORD-FFLATE", (b) => injectRecord(b, "ORD:16.6G replay", pick("16.6G win"), STAMP, fflate));
