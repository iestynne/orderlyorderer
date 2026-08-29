// Mirrors LevelData:save() exactly, as the byte-exact round-trip oracle
// (SPEC-002 §8.1). Every wall token is followed by a space, including the
// last on each row; entity and textbox lines are space-joined with no
// trailing space; the start-position line is "f x y".

import type { ParsedTower } from "./parser";

export function emitTower(tower: ParsedTower): string {
  const { metadata, floors } = tower;
  const out: string[] = [];

  out.push(metadata.name, "\n");
  out.push(String(metadata.crowns_needed), "\n");
  out.push(metadata.challenge, "\n");
  out.push(metadata.size, "\n");
  out.push(String(metadata.flags), "\n");
  out.push(String(metadata.start_power), "\n");
  out.push(String(metadata.start_floor), " ", String(metadata.start_x), " ", String(metadata.start_y), "\n");
  for (const g of metadata.grades) out.push(String(g), "\n");
  out.push(String(floors.length), "\n");

  for (const fl of floors) {
    out.push(fl.name, "\n");
    out.push(fl.bgm, "\n");
    for (const row of fl.walls) {
      for (const v of row) out.push(String(v), " ");
      out.push("\n");
    }
    out.push(String(fl.entities.length), "\n");
    for (const e of fl.entities) {
      out.push(String(e.x), " ", String(e.y), " ", e.type, " ", e.value_str, "\n");
    }
    out.push(String(fl.textboxes.length), "\n");
    for (const t of fl.textboxes) {
      out.push(String(t.x), " ", String(t.y), " ", String(t.w), " ", String(t.h), " ", t.str.replaceAll("\n", "||"), "\n");
    }
  }

  return out.join("");
}
