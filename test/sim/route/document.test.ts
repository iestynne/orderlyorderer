// SPEC-008 §9 — the document half of the Verification Contract: invariants 2,
// 3, 4, 7 and 9, and the named cases that need no simulation.

import { describe, expect, it } from "vitest";
import { activeSegment, flatten, importRoute, UNLIMITED_GEMS, type Route } from "../../../src/sim/route/document";
import { apply } from "../../../src/sim/route/edit";
import { canonicalJSON, emit, ordFile, parse } from "../../../src/sim/route/ordfile";
import { haveSaves, loadAllSaves } from "../../sav/helpers";
import { corpus, sameWaypoints } from "./helpers";

const d = haveSaves ? describe : describe.skip;

describe("SPEC-008 §2.4 — canonical serialization", () => {
  it("sorts object keys and emits no insignificant whitespace", () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("omits absent optional fields rather than writing null", () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("refuses a number that would serialize with an exponent", () => {
    expect(() => canonicalJSON(1e21)).toThrow(/exponent/);
    expect(() => canonicalJSON(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  it("round-trips the unlimited-gems sentinel exactly", () => {
    expect(canonicalJSON(UNLIMITED_GEMS)).toBe("9007199254740991");
    expect(JSON.parse(canonicalJSON(UNLIMITED_GEMS))).toBe(UNLIMITED_GEMS);
  });
});

describe("SPEC-008 §2 — a freshly imported route", () => {
  const route = importRoute({
    name: "r",
    tower: "1-1",
    gemsOwned: UNLIMITED_GEMS,
    waypoints: [
      { z: 1, x: 1, y: 1 }, { z: 1, x: 1, y: 2 },
      { z: 1, x: 1, y: 2 }, { z: 1, x: 2, y: 2 },
      { z: 1, x: 2, y: 2 },
    ],
  });

  it("has exactly one epoch", () => {
    expect(route.epochs.length).toBe(1);
  });

  it("has at least one segment in every epoch", () => {
    expect(Math.min(...route.epochs.map((e) => e.segments.length))).toBe(1);
  });

  it("pairs the entries into actions and keeps the live position on the route", () => {
    expect(activeSegment(route.epochs[0]!).actions.length).toBe(2);
    expect(route.final).toEqual({ z: 1, x: 2, y: 2 });
  });

  it("refuses an even entry list", () => {
    expect(() =>
      importRoute({ name: "r", tower: "1-1", gemsOwned: 0, waypoints: [{ z: 1, x: 1, y: 1 }, { z: 1, x: 1, y: 2 }] }),
    ).toThrow(/2S/);
  });
});

d("SPEC-008 §9 — named cases over the corpus", () => {
  it("every record imports: 326 over 14 towers", () => {
    const all = corpus();
    expect(all.length).toBe(326);
    expect(new Set(all.map((c) => c.towerId)).size).toBe(14);
  });

  it("records in a file run 10 to 48", () => {
    const counts = loadAllSaves().map((s) => s.file.records.length);
    expect(Math.min(...counts)).toBe(10);
    expect(Math.max(...counts)).toBe(48);
  });

  it("every entry count is odd, the 2S+1 rule: 326 / 326", () => {
    expect(corpus().filter((c) => c.waypoints.length % 2 === 1).length).toBe(326);
  });

  it("flatten() of an imported route is the entry list unchanged", () => {
    const bad = corpus().filter((c) => !sameWaypoints(flatten(c.route), c.waypoints));
    expect(bad.map((c) => c.id)).toEqual([]);
  });
});

d("SPEC-008 invariant 2 — split neutrality", () => {
  it("splitting at any action boundary leaves flatten() identical", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const n = activeSegment(c.route.epochs[0]!).actions.length;
      for (const i of boundaries(n)) {
        const split = apply(c.route, { op: "split", epoch: 0, index: i });
        if (!sameWaypoints(flatten(split), c.waypoints)) bad.push(`${c.id} @ ${i}`);
        if (split.epochs.length !== 2) bad.push(`${c.id} @ ${i}: ${split.epochs.length} epochs`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("splitting a multi-segment epoch is refused", () => {
    const c = corpus()[0]!;
    const two = apply(c.route, { op: "addSegment", epoch: 0 });
    expect(() => apply(two, { op: "split", epoch: 0, index: 1 })).toThrow(/no meaning/);
  });
});

d("SPEC-008 invariant 3 — merge inverts split", () => {
  it("merge(split(d, i)) restores flatten() exactly", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const n = activeSegment(c.route.epochs[0]!).actions.length;
      for (const i of boundaries(n)) {
        const back = apply(apply(c.route, { op: "split", epoch: 0, index: i }), { op: "merge", epoch: 0 });
        if (!sameWaypoints(flatten(back), c.waypoints)) bad.push(`${c.id} @ ${i}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-008 invariant 4 — toggle identity", () => {
  it("disabling an action and re-enabling it restores the byte-identical document", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const before = emit(ordFile([c.route]));
      const n = activeSegment(c.route.epochs[0]!).actions.length;
      for (const i of [0, n >> 1, n - 1].filter((k) => k >= 0 && k < n)) {
        const off = apply(c.route, { op: "setDisabled", epoch: 0, segment: 0, index: i, value: true });
        if (emit(ordFile([off])) === before) bad.push(`${c.id} @ ${i}: disabling changed nothing`);
        const on = apply(off, { op: "setDisabled", epoch: 0, segment: 0, index: i, value: false });
        if (emit(ordFile([on])) !== before) bad.push(`${c.id} @ ${i}: not restored`);
      }
    }
    expect(bad).toEqual([]);
  });
});

d("SPEC-008 invariant 7 — document round trip", () => {
  it("parse(emit(d)) equals d, and emit is byte-stable", () => {
    const bad: string[] = [];
    for (const c of corpus()) {
      const file = ordFile([edited(c.route)]);
      const text = emit(file);
      if (emit(file) !== text) bad.push(`${c.id}: emit is not stable`);
      const back = parse(text);
      if (emit(back) !== text) bad.push(`${c.id}: parse(emit(d)) does not re-emit`);
      if (JSON.stringify(back) !== JSON.stringify(file)) bad.push(`${c.id}: parse(emit(d)) differs from d`);
    }
    expect(bad).toEqual([]);
  });

  it("rejects a file whose format or version is wrong, with a sentence", () => {
    expect(() => parse('{"format":"nope","version":1,"routes":[]}')).toThrow(/document.format/);
    expect(() => parse('{"format":"orderlyorderer-route","version":2,"routes":[]}')).toThrow(/document.version/);
    expect(() => parse("not json")).toThrow(/not JSON/);
  });
});

/** Every optional field exercised, so the round trip is not tested on a bare document. */
function edited(route: Route): Route {
  // The corpus holds records of one and three entries, so the second half of a
  // split is routinely empty; every index below is clamped to what exists.
  const n = activeSegment(route.epochs[0]!).actions.length;
  let r = apply(route, { op: "split", epoch: 0, index: Math.min(1, n) });
  r = apply(r, { op: "rename", epoch: 0, name: "opening" });
  r = apply(r, { op: "rename", epoch: 1, segment: 0, name: "the rest" });
  r = apply(r, { op: "setSkippable", epoch: 0, value: true });
  r = apply(r, { op: "addSegment", epoch: 1 });
  if (activeSegment(r.epochs[1]!).actions.length > 0) {
    r = apply(r, { op: "setDisabled", epoch: 1, segment: 0, index: 0, value: true });
  }
  return r;
}

/** Head, middle and tail of an action list, plus both empty ends. */
function boundaries(n: number): number[] {
  return [...new Set([0, 1, n >> 1, n - 1, n])].filter((i) => i >= 0 && i <= n);
}
