// SPEC-007 §2.1 + docs/UI.md §1 — the record list's computed columns.
//
// `[D]` **The list appears at once and its numbers arrive behind it.**
// Power, highest floor and stop count are each the tail of a full simulation of
// that record's route, and a `.sav` holds up to 48 of them: 2-5 is 41 records
// and 156 546 steps, about three seconds, and every one of them used to be
// spent with a blank window on screen. Nothing on that screen needs the numbers
// to be there — the player is choosing a record by the name they gave it — so
// the wait is spent showing the list instead of hiding it. D41.

import { hasOrbMoves, routeFromRecord } from "../sav/route";
import type { SaveRecord } from "../sav/savefile";
import { stopStepIndices } from "../sim/cursor";
import { simulate } from "../sim/simulate";
import type { TowerJSON } from "../sim/types";

export interface Summary {
  record: SaveRecord;
  /** Orb moves are not simulated in this slice, so the row is never computed. */
  orbs: boolean;
  /** False until the record has been simulated; the columns read `…` meanwhile. */
  computed: boolean;
  power: number | null;
  highest: number | null;
  stops: number | null;
}

/** Player-named records sort above the AUTOSAVE_* ones: those names are the player's own index into their play. */
export function sortRecords(a: Summary, b: Summary): number {
  const auto = (s: Summary): number => (s.record.name.startsWith("AUTOSAVE") ? 1 : 0);
  return auto(a) - auto(b) || a.record.name.localeCompare(b.record.name);
}

/**
 * The list, in its final order, with nothing simulated yet.
 *
 * `[F]` The order is a function of the record names alone, so it is settled
 * before any of the numbers are — the rows never move once they are on screen.
 */
export function blankSummaries(records: readonly SaveRecord[]): Summary[] {
  return records
    .map((record) => ({
      record,
      orbs: hasOrbMoves(record),
      computed: false,
      power: null,
      highest: null,
      stops: null,
    }))
    .sort(sortRecords);
}

/** One record simulated. A record that will not replay keeps its name and loses its numbers. */
export function summarise(tower: TowerJSON, record: SaveRecord): Summary {
  const blank = { record, orbs: hasOrbMoves(record), computed: true, power: null, highest: null, stops: null };
  if (blank.orbs) return blank;
  try {
    const route = routeFromRecord(record);
    const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route });
    const last = t.steps.at(-1)?.player ?? t.initial;
    return {
      ...blank,
      power: last.power,
      highest: t.steps.reduce((m, s) => Math.max(m, s.player.z), t.initial.z),
      stops: stopStepIndices(t, route.length).length,
    };
  } catch {
    return blank;
  }
}

/**
 * Simulate each row in turn, handing back one at a time.
 *
 * `[D]` A macrotask between rows, so the browser paints what has arrived so
 * far. Without it the loop is the same three seconds with an extra `await` in
 * it. `cancelled` is checked at every yield, because opening a second file
 * while the first is still filling must not have two loops writing the list.
 */
export async function fillSummaries(
  tower: TowerJSON,
  rows: readonly Summary[],
  emit: (index: number, summary: Summary) => void,
  cancelled: () => boolean = () => false,
): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.orbs) continue;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (cancelled()) return;
    emit(i, summarise(tower, row.record));
  }
}
