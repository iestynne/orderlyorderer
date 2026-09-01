// SPEC-004 §8 / SPEC-007 §3 — the scrub cursor.
//
// The timeline is a journal, not a stack of snapshots: each step carries the
// cell edits it made and the whole player record afterwards. Scrubbing from
// step j to k therefore costs O(|k - j|) edits, whichever direction it runs.
//
// Pure module: no UI imports (D7). This is timeline mechanics, not
// presentation, which is why it lives in src/sim/.

import { depth } from "./grid";
import { CellState, W, type Addr, type Player, type Step, type Timeline } from "./types";

/**
 * SPEC-007 §3. seekTo returns the cells that changed, because the renderer
 * needs exactly that set and recomputing it would be the same walk twice.
 * SPEC-004 §8 declares the return `void`; SPEC-007 supersedes it.
 */
export class Cursor {
  readonly cells: Uint8Array;
  readonly kills: Int32Array;

  private readonly steps: readonly Step[];
  private i = 0;

  constructor(private readonly timeline: Timeline) {
    const D = depth(timeline.tower);
    this.cells = new Uint8Array(D * W * W);
    this.kills = new Int32Array(D);
    this.steps = timeline.steps;
  }

  /** Steps applied. 0 is the tower's initial state, before any move. */
  get index(): number {
    return this.i;
  }

  get length(): number {
    return this.steps.length;
  }

  /** State after `index` steps. */
  get player(): Player {
    return this.i === 0 ? this.timeline.initial : this.steps[this.i - 1]!.player;
  }

  /**
   * Move to step k, applying edits forward or undoing them backward. Returns
   * the addresses whose state actually differs, deduplicated: a cell touched
   * twice in one seek (Original -> Reinforced -> Gone, the pop-up chain)
   * appears once, and one touched back to where it began does not appear at
   * all. Invariant 3 asserts that exactness — a superset only wastes a repaint,
   * but a subset leaves a stale tile on the screen.
   */
  seekTo(k: number): readonly Addr[] {
    if (k < 0 || k > this.steps.length || !Number.isInteger(k)) {
      throw new RangeError(`seekTo(${k}) outside 0..${this.steps.length}`);
    }
    const was = new Map<Addr, CellState>();
    const note = (a: Addr): void => {
      if (!was.has(a)) was.set(a, this.cells[a]! as CellState);
    };

    while (this.i < k) {
      const s = this.steps[this.i]!;
      for (const e of s.edits) {
        note(e.addr);
        this.cells[e.addr] = e.after;
      }
      if (s.killedOn !== null) this.kills[s.killedOn - 1]!++;
      this.i++;
    }
    while (this.i > k) {
      const s = this.steps[this.i - 1]!;
      for (let j = s.edits.length - 1; j >= 0; j--) {
        const e = s.edits[j]!;
        note(e.addr);
        this.cells[e.addr] = e.before;
      }
      if (s.killedOn !== null) this.kills[s.killedOn - 1]!--;
      this.i--;
    }

    const changed: Addr[] = [];
    for (const [a, before] of was) if (this.cells[a] !== before) changed.push(a);
    return changed;
  }
}

/**
 * SPEC-007 §3 — where the scrub slider stops.
 *
 * A record's entries alternate `from, to, from, to, ..., current`: 2S+1 for S
 * actions. The odd indices below the last are the actions; the final entry is
 * the player's live position. So the stops are the S actions plus that final
 * position, S+1 in all — not one per simulated step, which is a detail of the
 * pathfinder and far too numerous to be useful.
 *
 * Returned as step indices, ready for Cursor.seekTo. Collapsing each
 * (from, to) pair into one stop is safe: the 2 751 position waypoints in the
 * corpus that do carry an edit are all pop-up walls reinforcing behind the
 * departing player, and those fold into the following action's state.
 */
export function stopStepIndices(timeline: Timeline, routeLength: number): number[] {
  if (routeLength % 2 !== 1) {
    throw new RangeError(`route length ${routeLength} is even; the 2S+1 rule requires odd`);
  }
  // stepsThrough[w] = steps produced by route entries 0..w. Steps are emitted
  // in waypoint order, so one forward pass fills it.
  const stepsThrough = new Int32Array(routeLength);
  let n = 0;
  let w = 0;
  for (const s of timeline.steps) {
    while (w < s.waypointIndex) stepsThrough[w++] = n;
    n++;
  }
  while (w < routeLength) stepsThrough[w++] = n;

  const stops: number[] = [];
  for (let i = 1; i < routeLength - 1; i += 2) stops.push(stepsThrough[i]!);
  stops.push(stepsThrough[routeLength - 1]!);
  return stops;
}
