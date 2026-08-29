// SPEC-002 §8.2 — tower inventory (exact).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOWER_IDS } from "../../../tools/maps/types";
import { ARCHIVE_DIR, loadAllTowers, loadTower } from "./helpers";

const EXPECTED: Record<string, { floors: number; name: string; hash12: string }> = {
  "1-1": { floors: 13, name: "1-1: Training Tower", hash12: "44efdab5d508" },
  "1-2": { floors: 14, name: "1-2: Tower of Might", hash12: "3dd685d21a6d" },
  "1-3": { floors: 15, name: "1-3: Tower of Traps", hash12: "8ec84c75d114" },
  "1-4": { floors: 17, name: "1-4: Miner's Obelisk", hash12: "a73652236866" },
  "1-5": { floors: 3, name: "1-5: Tiny Tower", hash12: "10c106b8d5a6" },
  "1-6": { floors: 25, name: "1-6: Adventurer's Exam", hash12: "ff6703ea4d39" },
  "2-1": { floors: 14, name: "2-1: Tower of Loot", hash12: "b2258eb1c0d0" },
  "2-2": { floors: 19, name: "2-2: Artificer's Task", hash12: "c1b025dcbc65" },
  "2-3": { floors: 18, name: "2-3: Thieves' Guild", hash12: "7f826d06afe1" },
  "2-4": { floors: 30, name: "2-4: Descent into Abyss", hash12: "f7b528c226c7" },
  "2-5": { floors: 32, name: "2-5: The Orderly Order", hash12: "00b4be2592a4" },
  "2-6": { floors: 75, name: "2-6: Golden Dojo", hash12: "52c0bdc9016f" },
  "3-1": { floors: 15, name: "3-1: Mystic Academy", hash12: "26250e59bef0" },
  "EX-1": { floors: 10, name: "EX-1: Jam Tower", hash12: "c275bdfa1fd7" },
  "EX-2": { floors: 10, name: "EX-2: Sorcerer's Tribute", hash12: "273ef79cde25" },
  "EX-3": { floors: 15, name: "EX-3: Lockpick Battle", hash12: "79179048a140" },
};

describe("tower inventory (SPEC-002 §8.2)", () => {
  it("has exactly 16 towers", () => {
    expect(TOWER_IDS.length).toBe(16);
  });

  it.each(TOWER_IDS)("tower %s matches expected floor count, name, content_hash", (id) => {
    const expected = EXPECTED[id];
    if (!expected) throw new Error(`no expectation table entry for ${id}`);
    const { bytes, parsed } = loadTower(id);
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(parsed.floors.length).toBe(expected.floors);
    expect(parsed.metadata.name).toBe(expected.name);
    expect(hash.slice(0, 12)).toBe(expected.hash12);
  });

  it("325 floors total across all 16 towers", () => {
    const towers = loadAllTowers();
    const total = towers.reduce((sum, t) => sum + t.parsed.floors.length, 0);
    expect(total).toBe(325);
  });

  it("24468 entities total across all 16 towers", () => {
    const towers = loadAllTowers();
    const total = towers.reduce((sum, t) => sum + t.parsed.floors.reduce((s, f) => s + f.entities.length, 0), 0);
    expect(total).toBe(24468);
  });

  it("88 textboxes total across all 16 towers", () => {
    const towers = loadAllTowers();
    const total = towers.reduce((sum, t) => sum + t.parsed.floors.reduce((s, f) => s + f.textboxes.length, 0), 0);
    expect(total).toBe(88);
  });

  it("game_version is v0.7-455 for the archive under test", () => {
    // The parser doesn't stamp game_version itself (that's the CLI's job from
    // .version), but the archive this test suite reads against must be the
    // pinned version the expected values above were measured against.
    const version = readFileSync(join(ARCHIVE_DIR, ".version"), "utf8").trim();
    expect(version).toBe("v0.7-455");
  });
});
