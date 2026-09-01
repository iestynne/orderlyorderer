// SPEC-007 §6.1 — getting the built atlas and the tower JSON into the app.
//
// `[D]` Per D14b-1 the assets ship INSIDE the bundle and the app offers no
// feature that hands them out: no download, no asset pack, no documented atlas
// endpoint. Inlining rather than emitting /assets/atlas.png removes the casual
// path. It is NOT protection and must not be described as such — extraction
// from a web app is easier than unzipping the .love, and the exposure delta is
// nil because anyone who wants the art already owns the game.
//
// build/ is produced by `npm run build-atlas` and is gitignored. Without it the
// app does not build, which is D29: no placeholder tileset in slice 1.

import atlasUrl from "../../build/atlas.png?inline";
import manifestJson from "../../build/atlas.json";
import type { AtlasManifest } from "../../tools/atlas/build";
import type { TowerJSON } from "../sim/types";

export const manifest = manifestJson as unknown as AtlasManifest;

const towerModules = import.meta.glob<{ default: TowerJSON }>("../../data/towers/v0.7-455/*.json");

export interface TowerIndexEntry {
  tower_id: string;
  name: string;
  floor_count: number;
}

export async function loadSheet(): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = atlasUrl;
  await img.decode();
  return img;
}

export function knownTowerIds(): string[] {
  return Object.keys(towerModules)
    .map((p) => p.slice(p.lastIndexOf("/") + 1, -".json".length))
    .filter((id) => id !== "index")
    .sort();
}

/** `[D]` §2.1: derive the tower from the filename stem; if it does not match, ask. */
export function towerIdFromFilename(name: string): string | null {
  const stem = name.replace(/\.sav$/i, "");
  return knownTowerIds().includes(stem) ? stem : null;
}

export async function loadTower(id: string): Promise<TowerJSON> {
  const key = Object.keys(towerModules).find((p) => p.endsWith(`/${id}.json`));
  if (!key) throw new Error(`no tower JSON for ${id}`);
  return (await towerModules[key]!()).default;
}
