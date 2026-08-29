// Both sides of the oracle emitted in ONE schema — the tower JSON — so a single
// structural differ compares them.
//
// SPEC-004 §11 oracle 3 asks for exactly this: "the extractor emits the same
// JSON schema as the tower initial-state files, fully populated, so one
// structural differ serves initial state, sim output and extractor output".
//
//   (a) towerJsonFromSim  — the simulator's predicted final state
//   (b) towerJsonFromPng  — the final state read out of the export
//   (c) diffTowerJson     — cell-for-cell comparison
//
// [D] (b) uses the simulator for NOTHING. Its sprite dictionary is learned from
// the image itself, keyed by the *initial* tower JSON, by majority vote per
// kind. That is what keeps the comparison honest: if the extractor were fed the
// sim's predictions it would agree with the sim by construction and prove
// nothing.

import { bandKey, panelGrid } from "./geometry";
import type { Png } from "./png";
import { predictedKind } from "./verify";
import { finalCellStates } from "./verify";
import { CellState, type Timeline } from "../sim/types";
import type { Cell, TowerJSON } from "../../tools/maps/types";

/** A cell the image cannot speak for: under the player marker or a textbox. */
export const UNKNOWN = "unknown" as const;
export type ExtractedCell = Cell | typeof UNKNOWN;

export interface ExtractedTower extends Omit<TowerJSON, "floors"> {
  floors: Array<Omit<TowerJSON["floors"][number], "cells"> & { cells: ExtractedCell[][] }>;
}

function shell(tower: TowerJSON, generator: string): ExtractedTower {
  return {
    ...tower,
    generator,
    floors: tower.floors.map((f) => ({ ...f, cells: f.cells.map((row) => [...row] as ExtractedCell[]) })),
  };
}

/** (a) The simulator's predicted final state, in tower-JSON shape. */
export function towerJsonFromSim(tower: TowerJSON, timeline: Timeline, masked: Iterable<string> = []): ExtractedTower {
  const out = shell(tower, `${tower.generator} +sim-final`);
  for (const [key, state] of finalCellStates(timeline)) {
    const [z, x, y] = key.split(",").map(Number) as [number, number, number];
    out.floors[z - 1]!.cells[y - 1]![x - 1] = state === CellState.Gone ? 0 : state === CellState.Reinforced ? 2 : out.floors[z - 1]!.cells[y - 1]![x - 1]!;
  }
  for (const key of masked) {
    const [z, x, y] = key.split(",").map(Number) as [number, number, number];
    out.floors[z - 1]!.cells[y - 1]![x - 1] = UNKNOWN;
  }
  return out;
}

export interface ExtractOptions {
  /** Cells the image cannot speak for; emitted as `unknown`. */
  masked?: Iterable<string>;
}

/**
 * (b) The final state read out of the export.
 *
 * The dictionary maps each kind to the band it renders as, learned from the
 * image and the INITIAL tower JSON alone. Nothing here consults the simulator.
 *
 * [D] The anchor is exact, not a majority vote. A first attempt took the most
 * common band per kind, which is wrong precisely where it matters: a route
 * consumes *most* keys, pickaxes and low-tier enemies, so for those kinds the
 * majority band is the empty one and every surviving instance reads as changed.
 *
 * The exact anchor uses the rule the whole spec rests on -- a cell has only
 * three possible outcomes:
 *
 *   1. `wall:0` cells can never become anything else, so any one of them gives
 *      the background band outright. Ground truth, no vote.
 *   2. Every other kind ends as either its own sprite, the background, or (for
 *      pop-ups) a Reinforced Wall. So that kind's sprite is simply the band
 *      that is *neither* of the other two -- and if no such band exists, every
 *      instance was consumed, which needs no sprite to say so.
 *
 * A kind showing two unexplained bands is a finding, reported rather than
 * averaged away.
 */
export function towerJsonFromPng(png: Png, tower: TowerJSON, opts: ExtractOptions = {}): ExtractedTower {
  const grid = panelGrid(png);
  const masked = new Set(opts.masked ?? []);

  // --- collect the bands each kind actually exhibits ---
  const bandsByKind = new Map<string, Set<string>>();
  for (let z = 1; z <= tower.floors.length; z++) {
    const floor = tower.floors[z - 1]!;
    for (let y = 1; y <= 15; y++) {
      for (let x = 1; x <= 15; x++) {
        if (masked.has(`${z},${x},${y}`)) continue;
        const kind = predictedKind(floor.cells[y - 1]![x - 1]!, CellState.Original);
        let s = bandsByKind.get(kind);
        if (s === undefined) bandsByKind.set(kind, (s = new Set()));
        s.add(bandKey(png, grid, z - 1, x, y));
      }
    }
  }

  // 1. background, from an unchangeable cell
  const emptyBands = bandsByKind.get("wall:0");
  if (emptyBands === undefined) throw new Error("no empty cell in the tower to anchor the background band");
  if (emptyBands.size !== 1) throw new Error(`empty floor cells render ${emptyBands.size} different ways; the export is not what we think`);
  const emptyBand = [...emptyBands][0]!;

  // 2. Reinforced, as the non-background band among wall:2 cells
  const reinforcedCandidates = [...(bandsByKind.get("wall:2") ?? [])].filter((b) => b !== emptyBand);
  if (reinforcedCandidates.length > 1) throw new Error(`Reinforced Walls render ${reinforcedCandidates.length} different ways`);
  const reinforcedBand = reinforcedCandidates[0];

  // 3. every other kind's sprite is the band that is neither of those
  const kindBand = new Map<string, string>([["wall:0", emptyBand]]);
  if (reinforcedBand !== undefined) kindBand.set("wall:2", reinforcedBand);
  const ambiguous: string[] = [];
  for (const [kind, bands] of bandsByKind) {
    if (kind === "wall:0" || kind === "wall:2") continue;
    const own = [...bands].filter((b) => b !== emptyBand && b !== reinforcedBand);
    if (own.length === 1) kindBand.set(kind, own[0]!);
    else if (own.length > 1) ambiguous.push(`${kind} (${own.length} unexplained bands)`);
    // own.length === 0: every instance was consumed; no sprite needed.
  }
  if (ambiguous.length > 0) {
    throw new Error(`kinds with more than one unexplained rendering: ${ambiguous.join(", ")}`);
  }

  // --- read every cell back ---
  const out = shell(tower, `${tower.generator} +png-extract`);
  for (let z = 1; z <= tower.floors.length; z++) {
    const floor = tower.floors[z - 1]!;
    for (let y = 1; y <= 15; y++) {
      for (let x = 1; x <= 15; x++) {
        if (masked.has(`${z},${x},${y}`)) {
          out.floors[z - 1]!.cells[y - 1]![x - 1] = UNKNOWN;
          continue;
        }
        const original = floor.cells[y - 1]![x - 1]!;
        const band = bandKey(png, grid, z - 1, x, y);
        if (band === kindBand.get(predictedKind(original, CellState.Original))) continue; // unchanged
        if (band === emptyBand) out.floors[z - 1]!.cells[y - 1]![x - 1] = 0;
        else if (reinforcedBand !== undefined && band === reinforcedBand) out.floors[z - 1]!.cells[y - 1]![x - 1] = 2;
        else {
          // The sim's rules permit no third outcome, so this is a finding.
          out.floors[z - 1]!.cells[y - 1]![x - 1] = UNKNOWN;
        }
      }
    }
  }
  return out;
}

export interface CellDiff {
  z: number;
  x: number;
  y: number;
  a: ExtractedCell;
  b: ExtractedCell;
}

/** (c) Structural comparison. Cells `unknown` on either side are skipped. */
export function diffTowerJson(a: ExtractedTower, b: ExtractedTower): { differences: CellDiff[]; compared: number; skipped: number } {
  const differences: CellDiff[] = [];
  let compared = 0;
  let skipped = 0;
  for (let z = 1; z <= a.floors.length; z++) {
    for (let y = 1; y <= 15; y++) {
      for (let x = 1; x <= 15; x++) {
        const ca = a.floors[z - 1]!.cells[y - 1]![x - 1]!;
        const cb = b.floors[z - 1]!.cells[y - 1]![x - 1]!;
        if (ca === UNKNOWN || cb === UNKNOWN) {
          skipped++;
          continue;
        }
        compared++;
        if (JSON.stringify(ca) !== JSON.stringify(cb)) differences.push({ z, x, y, a: ca, b: cb });
      }
    }
  }
  return { differences, compared, skipped };
}
