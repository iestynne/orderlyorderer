// SPEC-007 §3 and §8 — Cursor, its four invariants, and the D32 double build.
//
// Everything here runs headless against the save corpus. Stage 1 of the
// scrubber is fully covered by the Verification Contract and this is it.

import { describe, expect, it } from "vitest";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { Cursor, stopStepIndices } from "../../src/sim/cursor";
import { simulate } from "../../src/sim/simulate";
import { CellState, W, type Timeline, type Waypoint } from "../../src/sim/types";
import { haveSaves, loadAllSaves } from "../sav/helpers";
import { CursorRef, stopStepIndicesRef } from "./cursorRef";

const d = haveSaves ? describe : describe.skip;

const WORST = "2-5/F 211g 98.3M win H [A]";
const NAMED = "1-3/C wip 4F";

interface Replay {
  id: string;
  towerId: string;
  route: Waypoint[];
  timeline: Timeline;
}

let cache: Replay[] | null = null;
function corpus(): Replay[] {
  if (cache) return cache;
  cache = [];
  for (const { towerId, file, tower } of loadAllSaves()) {
    for (const rec of file.records) {
      if (hasOrbMoves(rec)) continue;
      const route = routeFromRecord(rec);
      const timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route });
      if (timeline.error) continue;
      cache.push({ id: `${towerId}/${rec.name}`, towerId, route, timeline });
    }
  }
  return cache;
}

function editCount(t: Timeline): number {
  return t.steps.reduce((a, s) => a + s.edits.length, 0);
}

// The corpus walks are hundreds of thousands of seeks. expect() per seek spends
// all its time in deep-equality machinery, so the hot loops compare by hand and
// only raise an expectation when something actually differs.
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A timeline's cells built forward-only, sharing no code path with Cursor's undo. */
function forwardCells(t: Timeline): Uint8Array {
  const c = new CursorRef(t);
  c.seekTo(t.steps.length);
  return c.cells;
}

d("SPEC-007 §8 — named cases", () => {
  it("the named record has 353 entries, 177 slider stops, 591 steps, 161 cell edits", () => {
    const r = corpus().find((x) => x.id === NAMED);
    expect(r, "record present in corpus").toBeDefined();
    const { route, timeline } = r!;
    expect(route.length, "entries").toBe(353);
    expect(stopStepIndices(timeline, route.length).length, "slider stops").toBe(177);
    expect(timeline.steps.length, "steps").toBe(591);
    expect(editCount(timeline), "cell edits").toBe(161);
  });

  it("slider stops are S+1 for 2S+1 entries, in every record", () => {
    for (const { id, route, timeline } of corpus()) {
      expect(stopStepIndices(timeline, route.length).length, id).toBe((route.length - 1) / 2 + 1);
    }
  });

  it("corpus maxima are 1773 stops and 1849 cell edits, in the same record", () => {
    let stops = { id: "", n: 0 };
    let edits = { id: "", n: 0 };
    for (const { id, route, timeline } of corpus()) {
      const s = stopStepIndices(timeline, route.length).length;
      const e = editCount(timeline);
      if (s > stops.n) stops = { id, n: s };
      if (e > edits.n) edits = { id, n: e };
    }
    expect(stops).toEqual({ id: WORST, n: 1773 });
    expect(edits).toEqual({ id: WORST, n: 1849 });
  });

  it("records in a file range over 10 to 48", () => {
    const counts = loadAllSaves().map((s) => s.file.records.length);
    expect(Math.min(...counts)).toBe(10);
    expect(Math.max(...counts)).toBe(48);
  });

  it("the largest tower a save can open is 2-5, at 32 floors", () => {
    const openable = loadAllSaves()
      .filter((s) => s.file.records.some((r) => !hasOrbMoves(r)))
      .map((s) => ({ id: s.towerId, floors: s.tower.floors.length }))
      .sort((a, b) => b.floors - a.floors);
    expect(openable[0]).toEqual({ id: "2-5", floors: 32 });
  });

  it("SaveFile carries no field naming a tower (§2.1)", () => {
    const rec = loadAllSaves()[0]!.file.records[0]!;
    expect(Object.keys(rec).sort()).toEqual(["entries", "keyOrder", "name", "time"]);
  });
});

d("SPEC-007 §8 — invariants", () => {
  // Invariant 1 is SPEC-004 invariant 8; this is the first thing to run it.
  it("1. journal fidelity: a sampled seek equals a fresh simulate truncated there", () => {
    const SAMPLES = 20;
    for (const { id, route, timeline } of corpus()) {
      const cur = new Cursor(timeline);
      const stride = Math.max(1, Math.floor(route.length / SAMPLES));
      for (let w = 0; w < route.length; w += stride) {
        const fresh = simulate({
          tower: timeline.tower,
          gemsOwned: Number.POSITIVE_INFINITY,
          route: route.slice(0, w + 1),
        });
        expect(fresh.error, `${id} truncated at ${w}`).toBeUndefined();
        cur.seekTo(fresh.steps.length);
        expect(cur.cells, `${id} cells at waypoint ${w}`).toEqual(forwardCells(fresh));
        expect(cur.player, `${id} player at waypoint ${w}`).toEqual(
          fresh.steps.length === 0 ? fresh.initial : fresh.steps.at(-1)!.player,
        );
      }
    }
  });

  it("2. seek symmetry: end then 0 restores cells, kills and player exactly", () => {
    for (const { id, timeline } of corpus()) {
      const cur = new Cursor(timeline);
      const cells0 = cur.cells.slice();
      const kills0 = cur.kills.slice();
      const player0 = cur.player;
      cur.seekTo(timeline.steps.length);
      cur.seekTo(0);
      expect(cur.cells, `${id} cells`).toEqual(cells0);
      expect(cur.kills, `${id} kills`).toEqual(kills0);
      expect(cur.player, `${id} player`).toEqual(player0);
      expect(cur.index).toBe(0);
    }
  });

  it("3. touched-set exactness: the returned Addr[] is exactly the differing set", () => {
    const failures: string[] = [];
    let seeks = 0;
    for (const { id, route, timeline } of corpus()) {
      const cur = new Cursor(timeline);
      const stops = stopStepIndices(timeline, route.length);
      // Forwards through every stop, then back down, so undo is covered too.
      for (const k of [...stops, ...[...stops].reverse(), 0]) {
        const before = cur.cells.slice();
        const changed = cur.seekTo(k);
        seeks++;
        const expected: number[] = [];
        for (let a = 0; a < before.length; a++) if (before[a] !== cur.cells[a]) expected.push(a);
        const got = [...changed].sort((x, y) => x - y);
        if (!same(got, expected)) failures.push(`${id} seek to ${k}: got ${got.length}, expected ${expected.length}`);
        if (new Set(changed).size !== changed.length) failures.push(`${id} seek to ${k}: duplicate addr`);
        if (failures.length > 5) break;
      }
      if (failures.length > 5) break;
    }
    expect(failures).toEqual([]);
    expect(seeks).toBeGreaterThan(300_000);
  });

  // Diagnostic for the 2026-08-31 correction (D18): naming the chains rather
  // than counting them is what caught the docs having the pop-up backwards. A
  // bound alone passes happily against a wrong chain.
  it("4. edit bound: at most 3 edits per cell, and only the three known chains", () => {
    const NAME = ["Original", "Gone", "Reinforced"];
    const chains = new Map<string, number>();
    let worst = 0;
    let worstFloor = 0;
    for (const { timeline } of corpus()) {
      const hist = new Map<number, string[]>();
      const perFloor = new Map<number, number>();
      for (const s of timeline.steps) {
        for (const e of s.edits) {
          const h = hist.get(e.addr) ?? [NAME[e.before]!];
          h.push(NAME[e.after]!);
          hist.set(e.addr, h);
          worst = Math.max(worst, h.length - 1);
          const z = Math.floor(e.addr / (W * W));
          const n = (perFloor.get(z) ?? 0) + 1;
          perFloor.set(z, n);
          worstFloor = Math.max(worstFloor, n);
        }
      }
      for (const h of hist.values()) {
        const key = h.join(" -> ");
        chains.set(key, (chains.get(key) ?? 0) + 1);
      }
    }
    expect(worst, "edits to a single cell").toBe(3);
    expect(worstFloor, "edits on a single floor").toBe(140);
    expect(Object.fromEntries(chains)).toEqual({
      "Original -> Gone": 187_069,
      // A pop-up is removed on entry and the wall raised behind on exit...
      "Original -> Gone -> Reinforced": 4_662,
      // ...and a Hyper Pickaxe can then destroy that ex-pop-up wall.
      "Original -> Gone -> Reinforced -> Gone": 14,
    });
  });

  it("3b. every edit is a legal transition (SPEC-004 invariant 3)", () => {
    const legal = new Set([
      `${CellState.Original}->${CellState.Gone}`,
      `${CellState.Gone}->${CellState.Reinforced}`,
      `${CellState.Reinforced}->${CellState.Gone}`,
    ]);
    const bad: string[] = [];
    for (const { id, timeline } of corpus()) {
      for (const s of timeline.steps) {
        for (const e of s.edits) {
          if (!legal.has(`${e.before}->${e.after}`)) bad.push(`${id}: ${e.before}->${e.after}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-007 §8 oracle 1 — every corpus record loads and scrubs", () => {
  it("326 records seek to every stop with no error and no stale tile", () => {
    let records = 0;
    let seeks = 0;
    for (const { route, timeline } of corpus()) {
      const cur = new Cursor(timeline);
      for (const k of stopStepIndices(timeline, route.length)) {
        cur.seekTo(k);
        seeks++;
      }
      expect(cur.index).toBe(timeline.steps.length);
      records++;
    }
    expect(records).toBe(326);
    expect(seeks).toBeGreaterThan(100_000);
  });
});

// D32. Two builds of the same spec, diffed against the corpus. The question is
// whether the docs determine the code; a divergence is either a bug, or an
// assumption that lived in one implementation and in nobody's head.
d("D32 — Cursor built twice, diffed over all 326 records", () => {
  it("both builds agree on cells, kills, player and touched set at every stop", () => {
    const divergences: string[] = [];
    let seeks = 0;
    for (const { id, route, timeline } of corpus()) {
      const a = new Cursor(timeline);
      const b = new CursorRef(timeline);
      const stops = stopStepIndices(timeline, route.length);
      if (!same(stopStepIndicesRef(timeline, route.length), stops)) divergences.push(`${id}: stop list`);
      for (const k of [...stops, ...[...stops].reverse(), 0]) {
        const ca = [...a.seekTo(k)].sort((x, y) => x - y);
        const cb = [...b.seekTo(k)].sort((x, y) => x - y);
        seeks++;
        if (!same(ca, cb)) divergences.push(`${id} @${k}: touched set, ${ca.length} vs ${cb.length}`);
        if (!same(a.cells, b.cells)) divergences.push(`${id} @${k}: cells`);
        if (!same(a.kills, b.kills)) divergences.push(`${id} @${k}: kills`);
        if (a.player !== b.player) divergences.push(`${id} @${k}: player identity`);
        if (divergences.length > 5) break;
      }
      if (divergences.length > 5) break;
    }
    expect(divergences).toEqual([]);
    expect(seeks).toBeGreaterThan(300_000);
  });
});
