// SPEC-007 §2.1 — the record list's computed columns, filled in behind the
// list rather than in front of it. D41.
//
// The diagnostic is that deferring the work changed nothing about the answer:
// the same rows, in the same order, with the same numbers. A list that filled
// in progressively but reordered itself as it went, or lost a row that will
// not replay, would be a worse screen than the three-second wait it replaced.

import { describe, expect, it } from "vitest";
import { blankSummaries, fillSummaries, sortRecords, summarise, type Summary } from "../../src/ui/records";
import { haveSaves, loadAllSaves } from "../sav/helpers";

const d = haveSaves ? describe : describe.skip;

d("the record list", () => {
  const save = () => loadAllSaves().find((s) => s.towerId === "1-5")!;

  it("is in its final order before anything has been simulated", () => {
    const { tower, file } = save();
    const blank = blankSummaries(file.records);
    const eager = file.records.map((r) => summarise(tower, r)).sort(sortRecords);

    expect(blank.map((s) => s.record.name)).toEqual(eager.map((s) => s.record.name));
    expect(blank.every((s) => !s.computed)).toBe(true);
    expect(blank.map((s) => s.orbs)).toEqual(eager.map((s) => s.orbs));
  });

  it("fills in one row at a time, and each row says what the eager pass said", async () => {
    const { tower, file } = save();
    const rows = blankSummaries(file.records).slice(0, 4);
    const seen: Array<[number, Summary]> = [];
    await fillSummaries(tower, rows, (i, s) => seen.push([i, s]));

    expect(seen.map(([i]) => i)).toEqual(rows.map((_, i) => i).filter((i) => !rows[i]!.orbs));
    for (const [i, s] of seen) {
      const eager = summarise(tower, rows[i]!.record);
      expect(s.computed).toBe(true);
      expect([s.power, s.highest, s.stops], s.record.name).toEqual([eager.power, eager.highest, eager.stops]);
    }
  });

  it("stops when the file it was filling has been replaced", async () => {
    const { tower, file } = save();
    const rows = blankSummaries(file.records);
    let emitted = 0;
    // Opening another save while this one is still filling: the old loop must
    // not go on writing rows into a list that is no longer on screen.
    await fillSummaries(tower, rows, () => emitted++, () => emitted >= 1);
    expect(emitted).toBe(1);
    expect(rows.length).toBeGreaterThan(1);
  });
});
