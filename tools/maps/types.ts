// Schema for tower JSON. Deliberately open (SPEC-002 §5) — no derived fields,
// no abstractions beyond what the source format already has.

export interface TowerJSON {
  tower_id: string; // map filename, e.g. "2-1"
  game_version: string; // from the archive's .version file, e.g. "v0.7-455"
  content_hash: string; // lowercase-hex SHA-256 of the source map file's exact bytes
  generator: string; // "orderlyorderer/tools/maps@<version>"
  metadata: TowerMetadata;
  floors: TowerFloor[];
}

// One merged grid per floor, not a wall grid plus a coordinate-keyed entity
// list (SPEC-002 §5). A cell is either a wall value or the entity standing
// there; it can never be both, which is what licenses the merge and is
// asserted per cell in mergeFloor().
export type Cell = WallValue | CellEntity;

/** 0 empty, 1 Weak, 2 Reinforced, 3 Iron. Confirmed against game.lua:1421-1509. */
export type WallValue = 0 | 1 | 2 | 3;

export interface CellEntity {
  type: string;
  value_str: string; // what the game prints on the tile; "999G" not "999000000000"
  value: number; // util.convert_value_str(value_str)
}

export function isCellEntity(c: Cell): c is CellEntity {
  return typeof c === "object";
}

export interface TowerMetadata {
  name: string;
  crowns_needed: number;
  challenge: string;
  size: string;
  flags: number;
  // The game's metadata.computed_flags, which game.lua:474 assigns wholesale
  // to game.flags. One table, two derivations (SPEC-002 A1): the first three
  // keys are bits of the flags int, the last two are set by the entity scan.
  // Each key is omitted when false, as the source's "and true or nil" does.
  computed_flags: {
    negative_keys?: true;
    uncapped_elixirs?: true;
    non_persistent_items_ex_4?: true;
    money_system?: true; // any money or money_door entity, on any floor
    orbs_exist?: true; // any orb_warp, orb_force or orb_change entity
  };
  start_power: number;
  start_floor: number;
  start_x: number;
  start_y: number;
  grades: [number, number, number, number, number, number]; // C B A S star overscore
}

export interface TowerEntity {
  x: number; // 1-based cell coordinate
  y: number; // 1-based cell coordinate
  type: string;
  value_str: string; // source of truth for round-trip; matches ^\d+[kMG]?$
  value: number; // util.convert_value_str(value_str)
}

export interface TowerTextbox {
  x: number; // pixels
  y: number; // pixels
  w: number; // pixels
  h: number; // pixels
  str: string; // "||" in the source decodes to "\n" here
}

// The parser's own shape: a faithful, order-preserving mirror of the source
// file. This is what the byte-exact round-trip oracle runs over (SPEC-002
// §8.1), so entity file order must survive here even though the emitted
// TowerJSON discards it.
export interface ParsedFloor {
  name: string;
  bgm: string;
  // Row-major, matching the source file's own line order: walls[y][x],
  // 0-based arrays, 15x15, values 0..3. The game's internal representation is
  // walls[x][y] — do NOT transpose when reading; the file's row y, token x
  // maps directly to walls[y][x] here.
  walls: number[][];
  entities: TowerEntity[];
  textboxes: TowerTextbox[];
}

// The emitted shape: one merged 15x15 grid, addressed cells[y - 1][x - 1] for
// the 1-based (x, y) the game and the save format use.
export interface TowerFloor {
  name: string;
  bgm: string;
  cells: Cell[][];
  textboxes: TowerTextbox[];
}

// The 41 top-level keys of entitydef.lua (the authoritative entity vocabulary,
// not sprite filenames). Five of these appear in no shipped map but must still
// be accepted by the parser (SPEC-002 §3.2).
export const ENTITY_TYPES: ReadonlySet<string> = new Set([
  "stairs_up",
  "stairs_down",
  "stairs_up_ex_4",
  "stairs_down_ex_4",
  "enemy",
  "enemy_neg",
  "elixir",
  "gate",
  "vorpal",
  "golden_dagger",
  "golden_claymore",
  "key",
  "dark_key",
  "door",
  "dark_door",
  "gem_door",
  "pickaxe",
  "light_rod",
  "dark_rod",
  "master_key",
  "hyper_pickaxe",
  "feather",
  "shield",
  "keysmasher",
  "crown",
  "dark_crown",
  "popup",
  "barrier_u",
  "barrier_r",
  "barrier_d",
  "barrier_l",
  "spikes",
  "money",
  "money_door",
  "battle_gate",
  "orb_force",
  "orb_change",
  "orb_warp",
  "rapier",
  "royal_boon1",
  "royal_boon2",
]);

// Entity types defined in entitydef.lua that occur in no shipped v0.7-455 map.
export const UNUSED_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "stairs_up_ex_4",
  "stairs_down_ex_4",
  "rapier",
  "royal_boon1",
  "royal_boon2",
]);

// Canonical enumeration order for the 16 towers (the archive's own ordering,
// per SPEC-002 §8.2 / the CLI contract). Not derived from directory listing
// order, which is not guaranteed stable across platforms.
export const TOWER_IDS: readonly string[] = [
  "1-1",
  "1-2",
  "1-3",
  "1-4",
  "1-5",
  "1-6",
  "2-1",
  "2-2",
  "2-3",
  "2-4",
  "2-5",
  "2-6",
  "3-1",
  "EX-1",
  "EX-2",
  "EX-3",
];
