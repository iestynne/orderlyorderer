// SPEC-002 §8.1 — byte-exact round trip, the primary oracle.

import { describe, expect, it } from "vitest";
import { emitTower } from "../../../tools/maps/emitter";
import { TOWER_IDS } from "../../../tools/maps/types";
import { loadTower } from "./helpers";

function firstDivergence(a: Buffer, b: Buffer): number | null {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  if (a.length !== b.length) return len;
  return null;
}

describe("byte-exact round trip (SPEC-002 §8.1)", () => {
  it.each(TOWER_IDS)("tower %s round-trips byte-for-byte", (id) => {
    const { bytes, parsed } = loadTower(id);
    const emitted = Buffer.from(emitTower(parsed), "utf8");
    const divergence = firstDivergence(bytes, emitted);
    if (divergence !== null) {
      throw new Error(
        `tower ${id}: first differing byte offset ${divergence} ` +
          `(source length ${bytes.length}, emitted length ${emitted.length})`,
      );
    }
    expect(emitted.equals(bytes)).toBe(true);
  });

  it("16/16 towers byte-identical", () => {
    let ok = 0;
    for (const id of TOWER_IDS) {
      const { bytes, parsed } = loadTower(id);
      const emitted = Buffer.from(emitTower(parsed), "utf8");
      if (emitted.equals(bytes)) ok++;
    }
    expect(ok).toBe(16);
  });
});
