// Builds the ORD-COLON probe (D16): a real EX-1 save with two injected records
// whose names the game's own keyboard cannot type. What it answers is in the
// paired `.md` -- this file only makes the bytes, and makes them again if the
// question changes.
//
//   ./node_modules/.bin/tsx tools/sav/make-probe.ts

import { readFileSync, writeFileSync } from "node:fs";
import { injectRecord } from "../../src/sav/inject";
import { parseSaveFile } from "../../src/sav/savefile";

const SRC = "data/saves/iestyn.2026.08.28/EX-1.sav";
const OUT = "data/saves/tests/EX-1.ORD-COLON.sav";

// `[D]` Both probes replay record 0's route, so either one loading is evidence
// the name did not disturb the payload beside it.
const NAMES = ["ORD:probe", "ORD:78901234567890123456"]; // 9 chars, and exactly 24

const src = new Uint8Array(readFileSync(SRC));
const route = parseSaveFile(src).records[0]!.entries;
let out: Uint8Array = src;
for (const name of NAMES) out = injectRecord(out, name, route, "2026-09-09 18:30");

writeFileSync(OUT, out);
const re = parseSaveFile(out);
console.log(`${OUT}: ${re.records.length} records, ${out.length} bytes (+${out.length - src.length})`);
console.log(NAMES.map((n) => `  ${JSON.stringify(n)} — ${n.length} chars`).join("\n"));
