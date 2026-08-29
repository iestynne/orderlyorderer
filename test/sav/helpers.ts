// Shared fixture for the save corpus. The saves are the player's own game data
// and live outside git (D14b), so every test that needs them SKIPS rather than
// fails when the directory is absent -- otherwise CI would look green while
// testing nothing.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile, type SaveFile } from "../../src/sav/savefile";
import { parseScoreFile, type ScoreTable } from "../../src/sav/score";
import type { TowerJSON } from "../../tools/maps/types";

export const SAVE_DIR = process.env["TOS_SAVE_DIR"] ?? join(process.cwd(), "data", "saves", "iestyn.2026.08.28");
export const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");

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
