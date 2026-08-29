// Parse a .sav and re-emit it through the TypeScript codec, to test whether the
// game accepts a stream produced by Node's deflate rather than Love2D's.
// SPEC-006 §6: the payload is byte-identical, only the compression differs.
//
//   npx tsx tools/sav/resave.ts <in.sav> <out.sav>

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { emitSaveFile, parseSaveFile } from "../../src/sav/savefile";
import { emitTop, parseTop } from "../../src/sav/buffer";

function main(): void {
  const [inPath, outPath] = process.argv.slice(2);
  const bytes = new Uint8Array(readFileSync(inPath!));
  const parsed = parseSaveFile(bytes);
  const out = emitSaveFile(parsed);

  // Prove the two files carry identical undo histories before handing it over:
  // a writer that changed a route would be a much worse bug than one that
  // merely compresses differently.
  const reparsed = parseSaveFile(out);
  if (reparsed.records.length !== parsed.records.length) throw new Error("record count changed");
  for (const [i, a] of parsed.records.entries()) {
    const b = reparsed.records[i]!;
    if (a.name !== b.name) throw new Error(`record ${i} name changed`);
    if (a.time !== b.time) throw new Error(`record ${a.name} time changed`);
    if (JSON.stringify(a.entries) !== JSON.stringify(b.entries)) throw new Error(`record ${a.name} entries changed`);
  }

  // And that each payload inflates to exactly the original bytes.
  const top = parseTop(bytes) as Map<string, unknown>;
  const newTop = parseTop(out) as Map<string, unknown>;
  let payloadsEqual = 0;
  for (const [name, v] of top) {
    const blobOf = (x: unknown): Uint8Array =>
      x instanceof Uint8Array ? x : ((x as Map<string, unknown>).get("data") as Uint8Array);
    const a = Buffer.from(inflateSync(Buffer.from(blobOf(v).subarray(8))));
    const b = Buffer.from(inflateSync(Buffer.from(blobOf(newTop.get(name)).subarray(8))));
    if (!a.equals(b)) throw new Error(`record ${name} payload differs`);
    payloadsEqual++;
  }

  writeFileSync(outPath!, out);
  console.log(`wrote ${outPath}`);
  console.log(`  records:            ${parsed.records.length}`);
  console.log(`  payloads identical: ${payloadsEqual}/${parsed.records.length}`);
  console.log(`  original bytes:     ${bytes.length}`);
  console.log(`  re-emitted bytes:   ${out.length}  (${out.length === bytes.length ? "same length" : (out.length > bytes.length ? "+" : "") + (out.length - bytes.length)})`);
  console.log(`  byte-identical:     ${Buffer.from(out).equals(Buffer.from(bytes))}`);
  console.log(`\n  Every route in the file is unchanged; only the deflate stream differs.`);
}

main();
