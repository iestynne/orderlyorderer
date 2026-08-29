// SPEC-004 §11 oracles 1 and 2, against the real save corpus.
//
// These are the primary regression net. Every waypoint must be both reachable
// -- exercising traversability, feather rules, one-way directions and stairs --
// and legal, exercising every gate, wall, enemy and item rule. Errors compound
// forward, so a single mis-modelled rule usually kills a whole replay rather
// than hiding.

import { describe, expect, it } from "vitest";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { haveSaves, loadAllSaves, loadScores } from "../sav/helpers";

const d = haveSaves ? describe : describe.skip;

d("SPEC-004 oracle 1 — zero-error replay sweep", () => {
  it("every save in every tower replays with no error", () => {
    const failures: string[] = [];
    let clean = 0;
    let steps = 0;
    for (const { towerId, file, tower } of loadAllSaves()) {
      for (const rec of file.records) {
        if (hasOrbMoves(rec)) continue;
        const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
        if (t.error) {
          const e = t.error;
          failures.push(`${towerId}/${rec.name}: ${e.code} at waypoint ${e.waypointIndex} -> (${e.at.z},${e.at.x},${e.at.y})`);
        } else {
          clean++;
          steps += t.steps.length;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(clean).toBe(326);
    // Guards against a change that makes the sweep vacuous by shortening routes.
    expect(steps).toBeGreaterThan(400_000);
  });

  it("no ACTION waypoint names a staircase (invariant 7a)", () => {
    // Stairs have no undo_store, so they never enter the undo history as an
    // action. A hit here would mean the save format is not what we think.
    //
    // The POSITION half of a pair is a different matter and routinely names a
    // staircase -- 244 times in this corpus -- because after taking stairs the
    // player is standing on the paired staircase. Draft 6 of SPEC-004 asserted
    // this over all waypoints, which was wrong; the corpus corrected it.
    const actionHits: string[] = [];
    let positionHits = 0;
    for (const { towerId, file, tower } of loadAllSaves()) {
      for (const rec of file.records) {
        const route = routeFromRecord(rec);
        route.forEach((w, i) => {
          const c = tower.floors[w.z - 1]?.cells[w.y - 1]?.[w.x - 1];
          if (typeof c !== "object") return;
          if (c.type !== "stairs_up" && c.type !== "stairs_down") return;
          // Entries alternate from, to, from, to, ..., current. Odd indexes
          // below the last are the acted-upon cell.
          if (i % 2 === 1 && i < route.length - 1) actionHits.push(`${towerId}/${rec.name} wp ${i}`);
          else positionHits++;
        });
      }
    }
    expect(actionHits).toEqual([]);
    expect(positionHits).toBe(244);
  });
});

d("SPEC-004 oracle 2 — hi-score", () => {
  it("every tower's AUTOSAVE_HISCORE reproduces the score file exactly", () => {
    const scores = loadScores();
    const rows: Array<[string, number, number]> = [];
    for (const { towerId, file, tower } of loadAllSaves()) {
      const rec = file.records.find((r) => r.name === "AUTOSAVE_HISCORE");
      const expected = scores.get(tower.metadata.name);
      if (rec === undefined || expected === undefined || hasOrbMoves(rec)) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      expect(t.error, `${towerId} replay`).toBeUndefined();
      const p = t.steps.at(-1)!.player;
      rows.push([towerId, expected, p.submittedScore]);
    }
    expect(rows.length).toBe(14);
    for (const [towerId, expected, got] of rows) {
      expect(got, `${towerId} hi-score`).toBe(expected);
    }
  });

  it("the numbered towers are Dark Crown runs and the EX towers are not", () => {
    // Not an assumption fed in: the sim derives `win` from which crown cell the
    // route ends on, so this is a second, independent thing the corpus agrees
    // with.
    const wins = new Map<string, number>();
    for (const { towerId, file, tower } of loadAllSaves()) {
      const rec = file.records.find((r) => r.name === "AUTOSAVE_HISCORE");
      if (!rec || hasOrbMoves(rec)) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      wins.set(towerId, t.steps.at(-1)!.player.win);
    }
    for (const [towerId, win] of wins) {
      expect(win, towerId).toBe(towerId.startsWith("EX-") ? 1 : 2);
    }
  });
});
