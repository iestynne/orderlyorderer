// SPEC-008 §7 — document to `.sav` record.
//
// `[D]` **Export never overwrites**: every write is a fresh, uniquely named
// file, which is what removes the destructive operation instead of warning
// about it (DESIGN §2.4). The naming is the caller's; this module produces
// bytes.
//
// Pure module: no UI imports, no filesystem (D7).

import { emitPayload } from "../../sav/savefile";
import type { TowerJSON, Waypoint } from "../types";
import { RouteShapeError, type Route } from "./document";
import { evaluate, type Evaluation } from "./evaluate";

export class ExportRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRefused";
  }
}

/**
 * The decompressed payload of a `.sav` record holding this route.
 *
 * `[D]` **Refuses a failing route before writing anything.** `[F]` The game's
 * loader would refuse it anyway by re-simulation (`RESULTS.md`); this only
 * makes the refusal ours, and legible.
 *
 * `[D]` The realised waypoint list is the evaluation's, not `flatten()`'s: a
 * skipped epoch contributed nothing to the route that ran, so it contributes
 * nothing to the route that is written. `[F]` Both are `2S+1` shaped, since an
 * action is a pair (§2.2) and a skipped epoch drops a whole number of them.
 *
 * `[D]` **An action that did nothing is not written either.** Insert a kill for
 * an enemy the route already kills and the later action has no work left; the
 * game never recorded interactions that changed nothing, so neither do we.
 */
export function toSaveRecord(route: Route, tower: TowerJSON, evaluation?: Evaluation): Uint8Array {
  const ev = evaluation ?? evaluate(route, tower, { forks: false });
  const e = ev.mainline.error;
  if (e !== undefined) {
    throw new ExportRefused(
      `route "${route.name}" fails at waypoint ${e.waypointIndex}, (${e.at.z},${e.at.x},${e.at.y}): ${e.code}`,
    );
  }
  if (ev.waypoints.length % 2 !== 1) {
    throw new RouteShapeError(`realised route has ${ev.waypoints.length} entries; the 2S+1 rule requires odd`);
  }
  const out: Waypoint[] = [];
  ev.noopActions.forEach((noop, k) => {
    if (!noop) out.push(ev.waypoints[2 * k]!, ev.waypoints[2 * k + 1]!);
  });
  out.push(ev.waypoints[ev.waypoints.length - 1]!);
  return emitPayload(out.map((w) => [w.z, w.x, w.y]));
}
