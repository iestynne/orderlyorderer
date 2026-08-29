// Shared test fixture: parses all 16 archive maps once and caches the result.
// Not itself a test file (no .test. in the name), but lives under
// test/tools/maps/ so "npm test -- maps" still covers it transitively.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTower, type ParsedTower } from "../../../tools/maps/parser";
import { TOWER_IDS } from "../../../tools/maps/types";

export const ARCHIVE_DIR = join(process.cwd(), "..", "local", "game", "v0.7-455");

export interface LoadedTower {
  id: string;
  bytes: Buffer;
  content: string;
  parsed: ParsedTower;
}

let cache: LoadedTower[] | null = null;

export function loadAllTowers(): LoadedTower[] {
  if (cache) return cache;
  cache = TOWER_IDS.map((id) => {
    const bytes = readFileSync(join(ARCHIVE_DIR, "res", "maps", id));
    const content = bytes.toString("utf8");
    const parsed = parseTower(id, content);
    return { id, bytes, content, parsed };
  });
  return cache;
}

export function loadTower(id: string): LoadedTower {
  const t = loadAllTowers().find((x) => x.id === id);
  if (!t) throw new Error(`no such tower in TOWER_IDS: ${id}`);
  return t;
}
