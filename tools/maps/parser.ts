// Text bytes -> TowerJSON's metadata/floors. Pure function: no filesystem
// access here (SPEC-002 §2, D7). A line-oriented reader over a sequential
// cursor, per D11 — not a class hierarchy, not a streaming parser.

import { ENTITY_TYPES, type ParsedFloor, type TowerEntity, type TowerMetadata, type TowerTextbox } from "./types";

export class MapParseError extends Error {
  constructor(towerId: string, floor: number | null, line: number, detail: string) {
    const where = floor === null ? `tower ${towerId}, line ${line}` : `tower ${towerId}, floor ${floor}, line ${line}`;
    super(`${where}: ${detail}`);
    this.name = "MapParseError";
  }
}

const VALUE_STR_RE = /^\d+[kMG]?$/;
const TEXTBOX_RE = /^(\d+) (\d+) (\d+) (\d+) (.+)$/;

/** Runs of non-whitespace, mirroring the game's util.get_tokens. */
function getTokens(line: string): string[] {
  return line.match(/\S+/g) ?? [];
}

/** Exact port of util.convert_value_str: no rounding (SPEC-002 §3.3). */
export function convertValueStr(str: string): number {
  let num = 0;
  for (const ch of str) {
    if (ch === "G") num = num * 1_000_000_000;
    else if (ch === "M") num = num * 1_000_000;
    else if (ch === "k") num = num * 1_000;
    else num = num * 10 + Number(ch);
  }
  return num;
}

export interface ParsedTower {
  metadata: TowerMetadata;
  floors: ParsedFloor[];
}

export function parseTower(towerId: string, content: string): ParsedTower {
  if (content.includes("\r")) {
    const idx = content.indexOf("\r");
    const lineNo = content.slice(0, idx).split("\n").length;
    throw new MapParseError(towerId, null, lineNo, "CRLF line ending is not accepted");
  }

  let cursor = 0;
  let lineNo = 0;
  let floor: number | null = null;

  function readLine(): string {
    const idx = content.indexOf("\n", cursor);
    if (idx === -1) {
      throw new MapParseError(towerId, floor, lineNo + 1, "unexpected end of file");
    }
    const line = content.slice(cursor, idx);
    cursor = idx + 1;
    lineNo++;
    return line;
  }

  function readInt(field: string): number {
    const raw = readLine();
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new MapParseError(towerId, floor, lineNo, `expected an integer for ${field}, got "${raw}"`);
    }
    return n;
  }

  // --- metadata ---
  const name = readLine();
  const crowns_needed = readInt("crowns_needed");
  const challenge = readLine();
  const size = readLine();
  const flags = readInt("flags");
  const computed_flags: TowerMetadata["computed_flags"] = {};
  if ((flags & 1) > 0) computed_flags.negative_keys = true;
  if ((flags & 2) > 0) computed_flags.uncapped_elixirs = true;
  if ((flags & 4) > 0) computed_flags.non_persistent_items_ex_4 = true;
  const start_power = readInt("start_power");
  const posTokens = getTokens(readLine());
  const start_floor = Number(posTokens[0]);
  const start_x = Number(posTokens[1]);
  const start_y = Number(posTokens[2]);
  const grades: TowerMetadata["grades"] = [
    readInt("grades[C]"),
    readInt("grades[B]"),
    readInt("grades[A]"),
    readInt("grades[S]"),
    readInt("grades[star]"),
    readInt("grades[overscore]"),
  ];

  const metadata: TowerMetadata = {
    name,
    crowns_needed,
    challenge,
    size,
    flags,
    computed_flags,
    start_power,
    start_floor,
    start_x,
    start_y,
    grades,
  };

  // --- floors ---
  const floorCount = readInt("floor_count");
  const floors: ParsedFloor[] = [];

  for (let f = 1; f <= floorCount; f++) {
    floor = f;
    const floorName = readLine();
    const bgm = readLine();

    const walls: number[][] = [];
    for (let y = 1; y <= 15; y++) {
      const tokens = getTokens(readLine());
      if (tokens.length !== 15) {
        throw new MapParseError(towerId, floor, lineNo, `wall row must have 15 tokens, got ${tokens.length}`);
      }
      const row: number[] = [];
      for (const tok of tokens) {
        const v = Number(tok);
        if (!Number.isInteger(v) || v < 0 || v > 3) {
          throw new MapParseError(towerId, floor, lineNo, `wall value must be 0..3, got "${tok}"`);
        }
        row.push(v);
      }
      walls.push(row);
    }

    const entityCount = readInt("entity_count");
    const entities: TowerEntity[] = [];
    for (let e = 0; e < entityCount; e++) {
      const tokens = getTokens(readLine());
      if (tokens.length !== 4) {
        throw new MapParseError(towerId, floor, lineNo, `entity line must have exactly 4 tokens, got ${tokens.length}`);
      }
      const [xTok, yTok, type, value_str] = tokens as [string, string, string, string];
      if (!ENTITY_TYPES.has(type)) {
        throw new MapParseError(towerId, floor, lineNo, `unknown entity type "${type}"`);
      }
      if (!VALUE_STR_RE.test(value_str)) {
        throw new MapParseError(towerId, floor, lineNo, `value_str "${value_str}" does not match ^\\d+[kMG]?$`);
      }
      entities.push({
        x: Number(xTok),
        y: Number(yTok),
        type,
        value_str,
        value: convertValueStr(value_str),
      });

      // Tower-level flags, accumulated during the entity scan exactly as
      // leveldata.lua:84-89 does it. SPEC-002 A1.
      if (type === "money" || type === "money_door") computed_flags.money_system = true;
      if (type === "orb_warp" || type === "orb_force" || type === "orb_change") computed_flags.orbs_exist = true;
    }

    const textboxCount = readInt("textbox_count");
    const textboxes: TowerTextbox[] = [];
    for (let b = 0; b < textboxCount; b++) {
      const line = readLine();
      const m = TEXTBOX_RE.exec(line);
      if (!m) {
        throw new MapParseError(towerId, floor, lineNo, `textbox line does not match "(\\d+) (\\d+) (\\d+) (\\d+) (.+)"`);
      }
      const [, x, y, w, h, s] = m as unknown as [string, string, string, string, string, string];
      textboxes.push({
        x: Number(x),
        y: Number(y),
        w: Number(w),
        h: Number(h),
        str: s.replaceAll("||", "\n"),
      });
    }

    floors.push({ name: floorName, bgm, walls, entities, textboxes });
  }

  floor = null;
  const remaining = content.slice(cursor);
  if (remaining.trim() !== "") {
    throw new MapParseError(towerId, null, lineNo + 1, `trailing content after the last declared floor: "${remaining.slice(0, 40)}"`);
  }

  return { metadata, floors };
}
