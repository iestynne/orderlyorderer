// Shared fixture: every corpus record as an imported route document.
//
// Like test/sav/helpers.ts, this SKIPS rather than fails when the save corpus
// is absent -- the saves are the player's own game data and live outside git
// (D14b), and a green suite that tested nothing would be worse than a skipped
// one.

import { hasOrbMoves, routeFromRecord } from "../../../src/sav/route";
import { emitPayload, type SaveRecord } from "../../../src/sav/savefile";
import { UNLIMITED_GEMS, importRoute, type Route } from "../../../src/sim/route/document";
import { payloadHash } from "../../../src/sim/route/ordfile";
import type { TowerJSON, Waypoint } from "../../../src/sim/types";
import { loadAllSaves } from "../../sav/helpers";

export { UNLIMITED_GEMS };

/**
 * `[F]` `1-3/POP-UP-FORMAT` is not a played route: it was written by hand
 * during the pop-up reverse-engineering, against an encoding that turned out to
 * be wrong (`RESULTS.md`). It replays clean and is kept, but it is where an odd
 * result should be blamed on the file first.
 */
export const HAND_WRITTEN = "1-3/POP-UP-FORMAT";

export interface Imported {
  id: string;
  towerId: string;
  tower: TowerJSON;
  record: SaveRecord;
  /** The 2S+1 list SPEC-006 reads. */
  waypoints: Waypoint[];
  payload: Uint8Array;
  route: Route;
}

let cache: Imported[] | null = null;

export function corpus(): Imported[] {
  if (cache) return cache;
  cache = [];
  for (const { towerId, file, tower } of loadAllSaves()) {
    for (const record of file.records) {
      if (hasOrbMoves(record)) continue;
      const waypoints = routeFromRecord(record);
      const payload = emitPayload(record.entries);
      cache.push({
        id: `${towerId}/${record.name}`,
        towerId,
        tower,
        record,
        waypoints,
        payload,
        route: importRoute({
          name: record.name,
          tower: towerId,
          gemsOwned: UNLIMITED_GEMS,
          waypoints,
          source: { file: `${towerId}.sav`, record: record.name, hash: payloadHash(payload) },
        }),
      });
    }
  }
  return cache;
}

/** The record SPEC-007 measured its ceiling on: 1 773 stops, 1 849 cell edits. */
export const WORST = "2-5/F 211g 98.3M win H [A]";

export function worst(): Imported {
  const w = corpus().find((c) => c.id === WORST);
  if (!w) throw new Error(`${WORST} is not in the corpus`);
  return w;
}

export function sameWaypoints(a: readonly Waypoint[], b: readonly Waypoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.z !== q.z || p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}
