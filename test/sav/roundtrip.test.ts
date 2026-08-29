// SPEC-006 §5.1-§5.2 — the codec's own oracles.

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { emitTop, parseTop } from "../../src/sav/buffer";
import { haveSaves, loadAllSaves } from "./helpers";

const d = haveSaves ? describe : describe.skip;

d("sav codec (SPEC-006 §5)", () => {
  it("5.1 the payload round trip is byte-exact for every record", () => {
    let exact = 0;
    let total = 0;
    const failures: string[] = [];
    for (const { towerId, bytes } of loadAllSaves()) {
      // Reach the blobs through the top-level table rather than the record
      // reader, so this test exercises buffer.ts directly.
      const top = parseTop(bytes);
      expect(top).toBeInstanceOf(Map);
      for (const [name, v] of top as Map<string, unknown>) {
        const blob = v instanceof Uint8Array ? v : ((v as Map<string, unknown>).get("data") as Uint8Array);
        const payload = Buffer.from(inflateSync(Buffer.from(blob.subarray(8))));
        const re = Buffer.from(emitTop(parseTop(new Uint8Array(payload))));
        total++;
        if (re.equals(payload)) exact++;
        else failures.push(`${towerId}/${name}`);
      }
    }
    expect(failures).toEqual([]);
    expect(exact).toBe(total);
    expect(total).toBe(326);
  });

  it("5.2 every record's entry count is odd (the 2S+1 rule)", () => {
    let records = 0;
    for (const { towerId, file } of loadAllSaves()) {
      for (const r of file.records) {
        expect(r.entries.length % 2, `${towerId}/${r.name}`).toBe(1);
        records++;
      }
    }
    expect(records).toBe(326);
  });

  it("entry arity is 3 everywhere in this corpus (orb 5-tuples are 3-1 only)", () => {
    const arities = new Set<number>();
    for (const { file } of loadAllSaves()) {
      for (const r of file.records) for (const e of r.entries) arities.add(e.length);
    }
    expect([...arities].sort()).toEqual([3]);
  });

  it("rejects a documented-but-unseen tag rather than misreading it", () => {
    // 0x0F is the string dict entry: the tag that would silently corrupt keys.
    expect(() => parseTop(new Uint8Array([0x0f, 0x00]))).toThrow(/0x0f/);
  });

  it("the .U two-byte form stops at 8159, and 8160 uses the 32-bit form", () => {
    // SPEC-006 §3: emitting 0xFF as a two-byte lead is the classic defect.
    const big = new Uint8Array(8160);
    const round = parseTop(emitTop(big));
    expect(round).toBeInstanceOf(Uint8Array);
    expect((round as Uint8Array).length).toBe(8160);
    const small = new Uint8Array(8159);
    expect((parseTop(emitTop(small)) as Uint8Array).length).toBe(8159);
  });
});
