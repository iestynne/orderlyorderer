// Shared fixture for the save corpus.
//
// `[F]` **The saves are committed**, unlike the tower JSON and the sprites.
// `[I]` iestyn, 2026-09-15: they are his own files and they are useful example
// data, so publishing them is the point rather than an oversight. `[D]` Tests
// still SKIP rather than fail when they are absent, because `TOS_SAVE_DIR` can
// point elsewhere and a clone may not have them -- and a suite that went green
// while testing nothing would be worse than either.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile, type SaveFile } from "../../src/sav/savefile";
import { parseScoreFile, type ScoreTable } from "../../src/sav/score";
import type { TowerJSON } from "../../tools/maps/types";

import { SAVE_DIR, TOWER_DIR } from "../../tools/paths";

export { SAVE_DIR, TOWER_DIR };

export const haveSaves = existsSync(SAVE_DIR);

export interface LoadedSave {
  towerId: string;
  file: SaveFile;
  bytes: Uint8Array;
  tower: TowerJSON;
}

let cache: LoadedSave[] | null = null;

export function loadAllSaves(): LoadedSave[] {
  if (cache) return cache;
  if (!haveSaves) return [];
  cache = readdirSync(SAVE_DIR)
    .filter((f) => f.endsWith(".sav"))
    .sort()
    .map((f) => {
      const towerId = basename(f, ".sav");
      const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, f)));
      return {
        towerId,
        bytes,
        file: parseSaveFile(bytes),
        tower: JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON,
      };
    });
  return cache;
}

export function loadScores(): ScoreTable {
  return parseScoreFile(readFileSync(join(SAVE_DIR, "score"), "utf8"));
}
