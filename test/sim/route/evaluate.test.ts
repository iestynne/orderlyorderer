// SPEC-008 §9 — the simulating half of the Verification Contract: invariants
// 1, 5, 6 and 8, and oracles 1 to 4.

import { describe, expect, it } from "vitest";
import { LuaArray, parseTop } from "../../../src/sav/buffer";
import { routeFromRecord } from "../../../src/sav/route";
import { stopStepIndices } from "../../../src/sim/cursor";
import { activeSegment, flatten, importRoute, type Route } from "../../../src/sim/route/document";
import { apply } from "../../../src/sim/route/edit";
import { evaluate } from "../../../src/sim/route/evaluate";
import { ExportRefused, toSaveRecord } from "../../../src/sim/route/export";
import { simulate } from "../../../src/sim/simulate";
import type { ErrorCode, Step, Timeline, TowerJSON, Waypoint } from "../../../src/sim/types";
import { haveSaves } from "../../sav/helpers";
import { corpus, sameWaypoints, worst, UNLIMITED_GEMS, type Imported } from "./helpers";

const d = haveSaves ? describe : describe.skip;

/**
 * SPEC-004 §7 lists fifteen codes, not the sixteen SPEC-008 §9 asked for; the
 * contract was the one that was wrong. Listed here so that a code added to or
 * removed from the simulator breaks this rather than passing quietly.
 */
const ERROR_CODES: ErrorCode[] = [
  "NO_PATH", "OFF_MAP", "NOT_ADJACENT",
  "BLOCKED_IRON", "BLOCKED_ONE_WAY", "BLOCKED_BATTLE_GATE",
  "NEED_LIGHT_KEY", "NEED_DARK_KEY", "NEED_GEMS", "NEED_GOLD",
  "NEED_PICKAXE", "NEED_HYPER_PICKAXE",
  "ENEMY_TOO_STRONG", "SPIKE_TOO_STRONG",
  "UNSUPPORTED_ENTITY",
];

/** A pair no map can hold, so the failure is certain and the same on every tower. */
const IMPOSSIBLE = { from: { z: 0, x: 99, y: 99 }, to: { z: 0, x: 99, y: 99 } };

d("SPEC-008 invariant 1 — import identity", () => {
  it("simulate(flatten(imported)) equals simulating the record directly", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const viaDocument = simulate({ tower: c.tower, gemsOwned: UNLIMITED_GEMS, route: flatten(c.route) });
      const straight = direct(c);
      if (!samePlayers(viaDocument.steps, straight.steps)) bad.push(`${c.id}: steps differ`);
      if (JSON.stringify(viaDocument.error) !== JSON.stringify(straight.error)) bad.push(`${c.id}: error differs`);
    }
    expect(bad).toEqual([]);
  });

  it("evaluate() reproduces that mainline, with one epoch result and nothing skipped", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const ev = evaluate(c.route, c.tower);
      if (ev.epochs.length !== 1) bad.push(`${c.id}: ${ev.epochs.length} epoch results`);
      if (ev.epochs[0]!.skipped) bad.push(`${c.id}: skipped`);
      if (!sameWaypoints(ev.waypoints, c.waypoints)) bad.push(`${c.id}: realised route differs`);
      if (!samePlayers(ev.mainline.steps, direct(c).steps)) bad.push(`${c.id}: steps differ`);
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-008 §9 — named cases that need the simulator", () => {
  it("the largest route: 1 773 slider stops, 1 849 cell edits", () => {
    const w = worst();
    const ev = evaluate(w.route, w.tower);
    expect(ev.mainline.error).toBeUndefined();
    expect(stopStepIndices(ev.mainline, ev.waypoints.length).length).toBe(1773);
    expect(edits(ev.mainline)).toBe(1849);
  });

  it("an epoch result surfaces the simulator's error codes: 15", () => {
    expect(new Set(ERROR_CODES).size).toBe(15);
  });
});

d("SPEC-008 invariant 5 — skip equals empty segment", () => {
  it("a failing skippable epoch leaves the mainline where an empty segment would", () => {
    const bad: string[] = [];
    for (const c of sample(40)) {
      const broken = breakMiddle(c.route);
      if (broken === null) continue;
      const skipping = evaluate(apply(broken, { op: "setSkippable", epoch: 1, value: true }), c.tower);
      const emptied = evaluate(
        apply(apply(broken, { op: "addSegment", epoch: 1 }), { op: "setActive", epoch: 1, segment: 1 }),
        c.tower,
      );
      if (!skipping.epochs[1]!.skipped) bad.push(`${c.id}: the epoch did not skip`);
      if (skipping.epochs[1]!.error === undefined) bad.push(`${c.id}: no error recorded for the skip`);
      if (skipping.mainline.error !== undefined) bad.push(`${c.id}: a skip stopped the route`);
      if (!samePlayers(skipping.mainline.steps, emptied.mainline.steps)) bad.push(`${c.id}: mainlines differ`);
      if (skipping.mainline.steps.length === 0) bad.push(`${c.id}: nothing ran, so the test proves nothing`);
    }
    expect(bad).toEqual([]);
  });

  it("a failing NON-skippable epoch stops the whole route", () => {
    const c = sample(1)[0]!;
    const broken = breakMiddle(c.route);
    expect(broken).not.toBeNull();
    const ev = evaluate(broken!, c.tower);
    expect(ev.mainline.error?.code).toBe("OFF_MAP");
    expect(ev.epochs[1]!.skipped).toBe(false);
    expect(ev.epochs[2]!.startStep).toBe(ev.mainline.steps.length);
  });
});

d("SPEC-008 invariant 6 — forward-pass locality", () => {
  it("changing active on epoch k leaves the state at the start of epoch k unchanged", () => {
    const bad: string[] = [];
    for (const c of sample(40)) {
      const three = intoEpochs(c.route, 3);
      if (three.epochs.length < 3) continue;
      const withAlt = apply(three, { op: "addSegment", epoch: 1 });
      const before = evaluate(withAlt, c.tower);
      const after = evaluate(apply(withAlt, { op: "setActive", epoch: 1, segment: 1 }), c.tower);
      const k = before.epochs[1]!.startStep;
      if (after.epochs[1]!.startStep !== k) bad.push(`${c.id}: epoch 1 starts at a different step`);
      if (!samePlayers(before.mainline.steps.slice(0, k), after.mainline.steps.slice(0, k))) {
        bad.push(`${c.id}: the prefix changed`);
      }
      if (before.mainline.steps.length === after.mainline.steps.length) {
        bad.push(`${c.id}: switching to an empty segment changed nothing, so the test proves nothing`);
      }
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-008 invariant 8 — fork isolation", () => {
  it("evaluating inactive segments leaves the mainline identical", () => {
    const bad: string[] = [];
    for (const c of sample(40)) {
      const doc = withTwin(intoEpochs(c.route, 3));
      if (doc === null) continue;
      const withForks = evaluate(doc, c.tower);
      const without = evaluate(doc, c.tower, { forks: false });
      if (!samePlayers(withForks.mainline.steps, without.mainline.steps)) bad.push(`${c.id}: mainline differs`);
      if (edits(withForks.mainline) !== edits(without.mainline)) bad.push(`${c.id}: edit counts differ`);
      // The twin is the active segment copied, so it must pass from the same
      // state -- a fork that failed would mean it had seen the mainline move.
      if (withForks.epochs[1]!.forks[1] !== null) bad.push(`${c.id}: the twin fork failed`);
      if (without.epochs[1]!.forks[1] !== null) bad.push(`${c.id}: a fork ran with forks off`);
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-008 oracle 1 — every record imports, evaluates and exports", () => {
  it("326 / 326 round trip through the exporter with the same flattened route", () => {
    let ok = 0;
    const bad: string[] = [];
    for (const c of corpus()) {
      const ev = evaluate(c.route, c.tower, { forks: false });
      if (ev.mainline.error) {
        bad.push(`${c.id}: ${ev.mainline.error.code}`);
        continue;
      }
      const reimported = importRoute({
        name: c.record.name,
        tower: c.towerId,
        gemsOwned: UNLIMITED_GEMS,
        waypoints: routeFromRecord({ ...c.record, entries: decode(toSaveRecord(c.route, c.tower, ev)) }),
      });
      if (!sameWaypoints(flatten(reimported), flatten(c.route))) bad.push(`${c.id}: re-import differs`);
      else ok++;
    }
    expect(bad).toEqual([]);
    expect(ok).toBe(326);
  });

  it("export refuses a failing route before writing anything", () => {
    const c = sample(1)[0]!;
    const broken = apply(c.route, { op: "insert", epoch: 0, segment: 0, index: 0, action: IMPOSSIBLE });
    expect(() => toSaveRecord(broken, c.tower)).toThrow(ExportRefused);
  });
});

d("SPEC-008 oracle 2 — an unedited export is byte-exact at the payload level", () => {
  it("326 / 326 payloads reproduced byte for byte", () => {
    let exact = 0;
    const bad: string[] = [];
    for (const c of corpus()) {
      const got = toSaveRecord(c.route, c.tower);
      if (got.length !== c.payload.length || got.some((b, i) => b !== c.payload[i])) bad.push(c.id);
      else exact++;
    }
    expect(bad).toEqual([]);
    expect(exact).toBe(326);
  });
});

d("SPEC-008 oracle 3 — segmentation sweep", () => {
  it("splitting each record into n epochs changes neither the route nor the run", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const base = evaluate(c.route, c.tower, { forks: false });
      for (const n of [2, 3, 5]) {
        const cut = intoEpochs(c.route, n);
        if (!sameWaypoints(flatten(cut), c.waypoints)) bad.push(`${c.id} /${n}: flatten differs (invariant 2)`);
        const ev = evaluate(cut, c.tower, { forks: false });
        if (!sameWaypoints(ev.waypoints, base.waypoints)) bad.push(`${c.id} /${n}: realised route differs`);
        if (!samePlayers(ev.mainline.steps, base.mainline.steps)) bad.push(`${c.id} /${n}: run differs (invariant 6)`);
      }
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-008 oracle 4 — re-evaluation against the ceiling", () => {
  it("a head insert on the 1 849-edit record re-evaluates inside 33 ms", () => {
    const { route, tower } = worst();
    const start = startOf(tower);
    // A no-op pair on the start tile: the whole route still replays, because
    // the point is to re-simulate everything rather than to break it early.
    const edited = apply(route, {
      op: "insert",
      epoch: 0,
      segment: 0,
      index: 0,
      action: { from: start, to: start },
    });
    const check = evaluate(edited, tower, { forks: false });
    expect(check.mainline.error).toBeUndefined();
    expect(edits(check.mainline)).toBe(1849);

    const runs: number[] = [];
    for (let i = 0; i < 25; i++) {
      const t0 = performance.now();
      evaluate(edited, tower, { forks: false });
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    const median = runs[runs.length >> 1]!;
    const max = runs[runs.length - 1]!;
    console.log(`oracle 4: head insert re-evaluated in ${median.toFixed(2)} ms median, ${max.toFixed(2)} ms max, ${runs.length} runs`);
    expect(median).toBeLessThan(33);
  });
});

// --- fixtures ------------------------------------------------------------

/** Player state after each step, compared field by field: cheap and total. */
function samePlayers(a: readonly Step[], b: readonly Step[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const s = a[i]!;
    const t = b[i]!;
    const p = s.player;
    const q = t.player;
    if (
      p.z !== q.z || p.x !== q.x || p.y !== q.y || p.power !== q.power || p.gold !== q.gold ||
      p.lightKeys !== q.lightKeys || p.darkKeys !== q.darkKeys || p.pickaxes !== q.pickaxes ||
      p.gemsSpent !== q.gemsSpent || p.held !== q.held || p.win !== q.win ||
      p.submittedScore !== q.submittedScore || s.to !== t.to || s.from !== t.from ||
      s.edits.length !== t.edits.length
    ) {
      return false;
    }
  }
  return true;
}

function edits(t: Timeline): number {
  return t.steps.reduce((n, s) => n + s.edits.length, 0);
}

function direct(c: Imported): Timeline {
  return simulate({ tower: c.tower, gemsOwned: UNLIMITED_GEMS, route: c.waypoints });
}

/**
 * The route cut into `n` epochs at even action boundaries. After the i-th
 * split, epoch i is the remaining tail, so the next cut is relative to it.
 */
function intoEpochs(route: Route, n: number): Route {
  const total = activeSegment(route.epochs[0]!).actions.length;
  const cuts: number[] = [];
  for (let k = 1; k < n; k++) {
    const c = Math.round((total * k) / n);
    if (c > 0 && c < total && c !== cuts[cuts.length - 1]) cuts.push(c);
  }
  let r = route;
  let taken = 0;
  cuts.forEach((c, i) => {
    r = apply(r, { op: "split", epoch: i, index: c - taken });
    taken = c;
  });
  return r;
}

/**
 * Three epochs, the middle one holding **nothing but** an impossible action.
 *
 * `[D]` The middle epoch has to be one the route can do without, or skipping it
 * strands everything after it and the invariant is asserted over two identical
 * wrecks. Splitting at index 0 makes an empty epoch to plant the action in, so
 * the skip restores exactly the unedited route -- which is the case feature 2
 * is for.
 */
function breakMiddle(route: Route): Route | null {
  const two = intoEpochs(route, 2);
  if (two.epochs.length < 2) return null;
  const withGap = apply(two, { op: "split", epoch: 1, index: 0 });
  return apply(withGap, { op: "insert", epoch: 1, segment: 0, index: 0, action: IMPOSSIBLE });
}

/** Three epochs, the middle one carrying a copy of its own segment as an alternative. */
function withTwin(route: Route): Route | null {
  if (route.epochs.length < 3) return null;
  return {
    ...route,
    epochs: route.epochs.map((e, i) =>
      i === 1 ? { ...e, segments: [e.segments[0]!, { name: "twin", actions: e.segments[0]!.actions.slice() }] } : e,
    ),
  };
}

/** An evenly spread slice, so a sample is not all one tower. */
function sample(n: number): Imported[] {
  const all = corpus();
  const stride = Math.max(1, Math.floor(all.length / n));
  return all.filter((_, i) => i % stride === 0).slice(0, n);
}

function startOf(tower: TowerJSON): Waypoint {
  const m = tower.metadata;
  return { z: m.start_floor, x: m.start_x, y: m.start_y };
}

/** Read an emitted payload back through SPEC-006's parser. */
function decode(payload: Uint8Array): number[][] {
  const outer = parseTop(payload);
  if (!(outer instanceof LuaArray)) throw new Error("payload is not an array");
  return outer.map((e) => (e as LuaArray).map((n) => n as number));
}
