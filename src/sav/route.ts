// A .sav record's undo history, read as a SPEC-004 route.
//
// SAVE_FORMAT.md §3: the entry list is 2S+1 long -- S pairs of (from, to), one
// pair per move the auto-pather cannot reproduce, then the player's live
// position. Every entry is a waypoint: the `from` entries resolve to passive
// walks (or no-ops, when the player is already there) and the `to` entries are
// the actions. Nothing needs to know which is which.

import type { Waypoint } from "../sim/types";
import type { Entry, SaveRecord } from "./savefile";

export class RouteShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteShapeError";
  }
}

export function entryToWaypoint(e: Entry): Waypoint {
  if (e.length < 3) throw new RouteShapeError(`entry has arity ${e.length}, expected at least 3`);
  return { z: e[0]!, x: e[1]!, y: e[2]! };
}

/** True if any entry carries the 5-tuple orb form we deliberately do not model. */
export function hasOrbMoves(rec: SaveRecord): boolean {
  return rec.entries.some((e) => e.length > 3);
}

export function routeFromRecord(rec: SaveRecord): Waypoint[] {
  if (rec.entries.length % 2 !== 1) {
    throw new RouteShapeError(`entry count ${rec.entries.length} is even; the 2S+1 rule requires odd`);
  }
  return rec.entries.map(entryToWaypoint);
}
