// SPEC-005 §10 oracle 2 — the reason the spec exists.
//
// Export at the start, replay the route in the simulator, export at the end,
// and assert the sim's predicted final cell states equal the image diff, cell
// for cell, with the player's cell masked.
//
// This is a fiercer check than the hi-score oracle: that compares one number,
// this compares every tile in the tower. A cell the sim wrongly leaves alone is
// caught just as surely as one it wrongly changes.

import { CellState, type Timeline } from "../sim/types";
import { coords } from "../sim/grid";
import type { CellChange, DiffResult } from "./diff";

export interface OracleMismatch {
  z: number;
  x: number;
  y: number;
  /** What the simulator predicted for this cell. */
  sim: "unchanged" | "empty" | "reinforced";
  /** What the image diff found. */
  image: "unchanged" | CellChange["kind"];
}

export interface OracleResult {
  matched: number;
  mismatches: OracleMismatch[];
  masked: number;
  /** Cells the image could not classify. Any of these is a finding, not noise. */
  unexpected: CellChange[];
}

const NAME: Record<number, "empty" | "reinforced"> = {
  [CellState.Gone]: "empty",
  [CellState.Reinforced]: "reinforced",
};

/**
 * Fold a timeline's journal into the final cell state, then compare against the
 * diff. Both sides are keyed by (z, x, y) so neither has to know the other's
 * addressing.
 */
export function compareToSim(timeline: Timeline, diff: DiffResult): OracleResult {
  const simFinal = new Map<string, "empty" | "reinforced">();
  for (const step of timeline.steps) {
    for (const e of step.edits) {
      const { z, x, y } = coords(e.addr);
      const name = NAME[e.after];
      if (name === undefined) simFinal.delete(`${z},${x},${y}`);
      else simFinal.set(`${z},${x},${y}`, name);
    }
  }

  const imageByCell = new Map<string, CellChange["kind"]>();
  for (const c of diff.changes) imageByCell.set(`${c.z},${c.x},${c.y}`, c.kind);

  const mismatches: OracleMismatch[] = [];
  const unexpected: CellChange[] = [];
  let matched = 0;
  let masked = 0;

  // Every cell either side claims changed, plus every cell the sim changed.
  const keys = new Set<string>([...simFinal.keys(), ...imageByCell.keys()]);
  for (const key of keys) {
    const [z, x, y] = key.split(",").map(Number) as [number, number, number];
    const image = imageByCell.get(key) ?? "unchanged";
    if (image === "unknown") {
      masked++;
      continue;
    }
    if (image === "unexpected") {
      unexpected.push({ z, x, y, kind: "unexpected" });
      continue;
    }
    const sim = simFinal.get(key) ?? "unchanged";
    if (sim === image) matched++;
    else mismatches.push({ z, x, y, sim, image });
  }

  return { matched, mismatches, masked, unexpected };
}
