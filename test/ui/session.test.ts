// The mapping the whole editing UI rests on: slider stop i is action i.
//
// SPEC-008 §9 does not cover the UI, and says so. This is not a substitute for
// looking at it (D24a). What it covers is the one piece of the UI that is not a
// matter of taste — if `sites[i]` names a different action from the one the
// slider is standing on, every click in add and remove mode edits the wrong
// place, and no amount of looking would tell you which.

import { describe, expect, it } from "vitest";
import { Cursor } from "../../src/sim/cursor";
import { activeSegment } from "../../src/sim/route/document";
import { apply } from "../../src/sim/route/edit";
import { RouteSession } from "../../src/ui/session";
import type { ViewState } from "../../src/store/working";
import { haveSaves } from "../sav/helpers";
import { corpus, type Imported } from "../sim/route/helpers";

const d = haveSaves ? describe : describe.skip;

/** Half of the corpus's 2S+1 entries, summed: one action per recorded pair. */
const EXPECTED_ACTIONS = 198_496;

const VIEW: ViewState = { route: 0, stop: 0, captions: true, zoom: "auto" };

function session(c: Imported): RouteSession {
  return new RouteSession({ format: "orderlyorderer-route", version: 1, routes: [c.route] }, 0, c.tower, { ...VIEW });
}

/** The same route with the action at `index` switched off. */
function disabled(c: Imported, index: number): RouteSession {
  const route = apply(c.route, { op: "setDisabled", epoch: 0, segment: 0, index, value: true });
  return new RouteSession({ format: "orderlyorderer-route", version: 1, routes: [route] }, 0, c.tower, { ...VIEW });
}

/** An insertion the rules will accept nowhere in particular: it is never run. */
function insert(s: RouteSession, index: number): void {
  s.edit({
    op: "insert",
    epoch: 0,
    segment: 0,
    index,
    action: { from: { z: 1, x: 1, y: 1 }, to: { z: 1, x: 1, y: 2 } },
  });
}

/** An evenly spread slice, so a sample is not all one tower. */
function sample(n: number): Imported[] {
  const all = corpus();
  const stride = Math.max(1, Math.floor(all.length / n));
  return all.filter((_, i) => i % stride === 0).slice(0, n);
}

d("RouteSession — stops, sites and the marker", () => {
  it("has one site per stop below the last, and each names that stop's action", () => {
    const bad: string[] = [];
    for (const c of sample(40)) {
      const s = session(c);
      if (s.sites.length !== s.stops.length - 1) {
        bad.push(`${c.id}: ${s.sites.length} sites for ${s.stops.length} stops`);
        continue;
      }
      s.sites.forEach((site, i) => {
        const w = s.evaluation.waypoints[2 * i + 1]!;
        if (site.action.to.z !== w.z || site.action.to.x !== w.x || site.action.to.y !== w.y) {
          bad.push(`${c.id}: site ${i} is not the action at stop ${i}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("takes a disabled action out of the route and leaves its stop in place", () => {
    const c = sample(1)[0]!;
    const before = session(c);
    const off = disabled(c, 1);

    // Out of the route: both its waypoints go, and the list stays 2S+1 shaped.
    expect(off.evaluation.waypoints.length).toBe(before.evaluation.waypoints.length - 2);
    expect(off.evaluation.waypoints.length % 2).toBe(1);

    // ...and still in the list: same count of actions, same numbering, and the
    // stop it holds is its predecessor's, because it did nothing (§4.1).
    expect(off.sites.length).toBe(before.sites.length);
    expect(off.stops.length).toBe(before.stops.length);
    expect(off.sites[1]!.live).toBe(false);
    expect(off.stops[1]).toBe(off.stops[0]);
    // Everything before it is untouched.
    expect(off.stops[0]).toBe(before.stops[0]);
  });

  it("re-enabling restores every stop", () => {
    const c = sample(1)[0]!;
    const before = session(c);
    const s = disabled(c, 1);
    s.edit({ op: "setDisabled", epoch: 0, segment: 0, index: 1, value: false });
    expect(s.stops).toEqual(before.stops);
  });

  it("marks the document dirty on an edit and clean again on a save", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.edit({ op: "setDisabled", epoch: 0, segment: 0, index: 0, value: true });
    expect(s.dirty).toBe(true);
    // Not a sticky flag: putting it back must clear the marker (DESIGN §2.3).
    s.edit({ op: "setDisabled", epoch: 0, segment: 0, index: 0, value: false });
    expect(s.dirty).toBe(false);
  });

  it("undoes and redoes insertions, one at a time", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    const n = activeSegment(s.route.epochs[0]!).actions.length;
    expect(s.canUndo).toBe(false);

    for (let i = 0; i < 3; i++) insert(s, i);
    expect(activeSegment(s.route.epochs[0]!).actions.length).toBe(n + 3);

    s.undo();
    s.undo();
    expect(activeSegment(s.route.epochs[0]!).actions.length).toBe(n + 1);
    s.redo();
    expect(activeSegment(s.route.epochs[0]!).actions.length).toBe(n + 2);
  });

  // `[I]` Insert four here, scrub away, insert four there: Z takes back four.
  // The run is what undo reaches over, and a scrub ends it (SPEC-008 §5).
  it("will not undo back past the start of the current run", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    const n = activeSegment(s.route.epochs[0]!).actions.length;

    for (let i = 0; i < 4; i++) insert(s, i);
    s.endRun(); // what a scrub does
    for (let i = 0; i < 4; i++) insert(s, 20 + i);
    expect(s.canUndo).toBe(true);

    for (let i = 0; i < 10; i++) s.undo();
    expect(s.canUndo).toBe(false);
    expect(activeSegment(s.route.epochs[0]!).actions.length).toBe(n + 4);
  });

  it("a toggle ends the run too, and is not itself undoable", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    insert(s, 0);
    expect(s.canUndo).toBe(true);
    s.edit({ op: "setDisabled", epoch: 0, segment: 0, index: 3, value: true });
    expect(s.canUndo).toBe(false);
  });

  it("a new insertion clears what undo had taken back", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    insert(s, 0);
    s.undo();
    expect(s.canRedo).toBe(true);
    insert(s, 0);
    expect(s.canRedo).toBe(false);
  });

  // SPEC-008 §4.2. The classification's rules are unit-tested in
  // test/sim/route/describe.test.ts; this is the sweep over real routes, which
  // goes through the stop model that pairs an action with the state either
  // side of it -- the part a fixture cannot exercise.
  it("describes every action of every corpus record", () => {
    const kinds: Record<string, number> = {};
    let actions = 0;
    let withGold = 0;
    for (const c of corpus()) {
      const s = session(c);
      const cursor = new Cursor(s.evaluation.mainline);
      for (let i = 0; i < s.sites.length; i++) {
        const summary = s.summarise(cursor, i);
        expect(summary, `${c.id} action ${i}`).not.toBeNull();
        kinds[summary!.kind] = (kinds[summary!.kind] ?? 0) + 1;
        if (summary!.goldGained > 0) withGold++;
        actions++;
      }
    }
    console.log(`describe: ${actions} actions, ${withGold} earning gold — ${JSON.stringify(kinds)}`);
    expect(actions).toBe(EXPECTED_ACTIONS);
    // A recorded interaction is one that changed state (SAVE_FORMAT §3), so an
    // action landing on a wall it cannot enter would mean the pairing that
    // decides which waypoint is the action is out.
    expect(kinds["blocked"] ?? 0).toBe(0);
    // `[F]` **Exactly one walk**, and it is real: `1-3/POP-UP-FORMAT` action 0,
    // a save made while reverse-engineering the pop-up encoding. Its recorded
    // interaction is the chain committing behind the player, on a square the
    // tower itself has as empty floor, so there is nothing else it could name.
    // The other case this used to catch -- a pop-up already stepped through --
    // is named by the tower's own cell now.
    expect(kinds["walk"] ?? 0).toBe(1);
    expect(kinds["attack"]).toBe(118_724);
    expect(kinds["pickup"]).toBe(32_973);
    expect(kinds["gate"]).toBe(24_497);
    expect(kinds["hazard"]).toBe(11_945);
    expect(kinds["dig"]).toBe(10_205);
    expect(kinds["crown"]).toBe(151);
  });

  it("badges an inserted action, and carries the badge across a disable", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    const action = { from: { z: 1, x: 1, y: 1 }, to: { z: 1, x: 1, y: 2 } };
    s.edit({ op: "insert", epoch: 0, segment: 0, index: 0, action });
    expect(s.badgeOf(activeSegment(s.route.epochs[0]!).actions[0]!)).toBe("inserted");
    s.edit({ op: "setDisabled", epoch: 0, segment: 0, index: 0, value: true });
    const now = activeSegment(s.route.epochs[0]!).actions[0]!;
    expect(s.badgeOf(now)).toBe("disabled");
    s.edit({ op: "setDisabled", epoch: 0, segment: 0, index: 0, value: false });
    expect(s.badgeOf(activeSegment(s.route.epochs[0]!).actions[0]!)).toBe("inserted");
    expect(s.insertedPaths()).toEqual(["0/0/0"]);
  });
});
