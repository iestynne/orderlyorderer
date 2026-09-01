// D32 second build of SPEC-004 §8 / SPEC-007 §3, written to the spec text
// rather than to src/sim/cursor.ts.
//
// The strategy is deliberately the other one: where Cursor walks the journal
// in whichever direction is shorter, this rebuilds the state from step 0 every
// time and diffs the whole grid to find what moved. It is O(k) per seek and
// O(cells) per diff, which the spec forbids for the real thing -- but it shares
// no code path with the incremental undo, which is exactly where an
// incremental cursor can be wrong and a rebuild cannot.
//
// Test-only. Not shipped, not imported by src/.

import { depth } from "../../src/sim/grid";
import { W, type Addr, type Player, type Timeline } from "../../src/sim/types";

export class CursorRef {
  readonly cells: Uint8Array;
  readonly kills: Int32Array;
  private i = 0;

  constructor(private readonly t: Timeline) {
    const D = depth(t.tower);
    this.cells = new Uint8Array(D * W * W);
    this.kills = new Int32Array(D);
  }

  get index(): number {
    return this.i;
  }

  get player(): Player {
    return this.i === 0 ? this.t.initial : this.t.steps[this.i - 1]!.player;
  }

  seekTo(k: number): readonly Addr[] {
    if (k < 0 || k > this.t.steps.length || !Number.isInteger(k)) {
      throw new RangeError(`seekTo(${k}) outside 0..${this.t.steps.length}`);
    }
    const before = this.cells.slice();
    this.cells.fill(0);
    this.kills.fill(0);
    for (let n = 0; n < k; n++) {
      const s = this.t.steps[n]!;
      for (const e of s.edits) this.cells[e.addr] = e.after;
      if (s.killedOn !== null) this.kills[s.killedOn - 1]!++;
    }
    this.i = k;

    const changed: Addr[] = [];
    for (let a = 0; a < this.cells.length; a++) if (this.cells[a] !== before[a]) changed.push(a);
    return changed;
  }
}

/**
 * D32 second build of stopStepIndices. Same contract, different derivation:
 * this one asks each step which waypoint produced it, rather than building a
 * prefix table over the route.
 */
export function stopStepIndicesRef(t: Timeline, routeLength: number): number[] {
  if (routeLength % 2 !== 1) throw new RangeError(`route length ${routeLength} is even`);
  const stopAfter = (w: number): number => {
    let n = 0;
    for (const s of t.steps) if (s.waypointIndex <= w) n++;
    return n;
  };
  const stops: number[] = [];
  for (let i = 1; i < routeLength - 1; i += 2) stops.push(stopAfter(i));
  stops.push(t.steps.length);
  return stops;
}
