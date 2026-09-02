// The mapping the whole editing UI rests on: slider stop i is action i.
//
// SPEC-008 §9 does not cover the UI, and says so. This is not a substitute for
// looking at it (D24a). What it covers is the one piece of the UI that is not a
// matter of taste — if `sites[i]` names a different action from the one the
// slider is standing on, every click in add and remove mode edits the wrong
// place, and no amount of looking would tell you which.

import { describe, expect, it } from "vitest";
import { activeSegment } from "../../src/sim/route/document";
import { apply } from "../../src/sim/route/edit";
import { RouteSession } from "../../src/ui/session";
import type { ViewState } from "../../src/store/working";
import { haveSaves } from "../sav/helpers";
import { corpus, type Imported } from "../sim/route/helpers";

const d = haveSaves ? describe : describe.skip;

const VIEW: ViewState = { route: 0, stop: 0, mode: "scrub", selection: null, captions: true, zoom: "auto" };

function session(c: Imported): RouteSession {
  return new RouteSession({ format: "orderlyorderer-route", version: 1, routes: [c.route] }, 0, c.tower, { ...VIEW });
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

  it("skips a disabled action, and both its waypoints leave the route", () => {
    const c = sample(1)[0]!;
    const before = session(c);
    const n = before.sites.length;
    const off = new RouteSession(
      { format: "orderlyorderer-route", version: 1, routes: [apply(c.route, { op: "setDisabled", epoch: 0, segment: 0, index: 0, value: true })] },
      0,
      c.tower,
      { ...VIEW },
    );
    expect(off.sites.length).toBe(n - 1);
    expect(off.evaluation.waypoints.length).toBe(before.evaluation.waypoints.length - 2);
    expect(off.evaluation.waypoints.length % 2).toBe(1);
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

  it("undoes and redoes one edit at a time", () => {
    const c = sample(1)[0]!;
    const s = session(c);
    const n = activeSegment(s.route.epochs[0]!).actions.length;
    expect(s.canUndo).toBe(false);
    s.edit({ op: "split", epoch: 0, index: 1 });
    expect(s.route.epochs.length).toBe(2);
    s.undo();
    expect(s.route.epochs.length).toBe(1);
    expect(activeSegment(s.route.epochs[0]!).actions.length).toBe(n);
    s.redo();
    expect(s.route.epochs.length).toBe(2);
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
