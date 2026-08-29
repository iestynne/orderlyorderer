// SPEC-004 §3. Core types for the simulation engine.
// Pure module: no UI imports, no I/O (D7).

import type { Cell, CellEntity, TowerJSON } from "../../tools/maps/types";

export const MAX_POWER = 999_999_999_999;
export const ELIXIR_CAP = 1_000_000_000;
export const W = 15;

/** Opaque 0-based index. Build only with addr(); never do arithmetic on one. */
export type Addr = number;

export type HeldItem =
  | "vorpal"
  | "golden_dagger"
  | "golden_claymore"
  | "light_rod"
  | "dark_rod"
  | "master_key"
  | "hyper_pickaxe"
  | "feather"
  | "shield"
  | "keysmasher";

export interface Player {
  z: number; x: number; y: number; // 1-based
  power: number;
  gold: number;
  lightKeys: number;
  darkKeys: number;
  pickaxes: number;
  gemsSpent: number;
  held: HeldItem | null;
  pendingPopup: Addr | null;
  win: 0 | 1 | 2;
  submittedScore: number;
}

export const enum CellState {
  Original = 0,
  Gone = 1,
  Reinforced = 2,
}

export interface CellEdit {
  addr: Addr;
  before: CellState;
  after: CellState;
}

export type ErrorCode =
  | "NO_PATH" | "OFF_MAP" | "NOT_ADJACENT"
  | "BLOCKED_IRON" | "BLOCKED_ONE_WAY" | "BLOCKED_BATTLE_GATE"
  | "NEED_LIGHT_KEY" | "NEED_DARK_KEY" | "NEED_GEMS" | "NEED_GOLD"
  | "NEED_PICKAXE" | "NEED_HYPER_PICKAXE"
  | "ENEMY_TOO_STRONG" | "SPIKE_TOO_STRONG"
  | "UNSUPPORTED_ENTITY";

export interface SimError {
  waypointIndex: number;
  stepIndex: number | null;
  code: ErrorCode;
  at: Waypoint;
  have?: number;
  need?: number;
}

export interface Waypoint { z: number; x: number; y: number }

export interface Step {
  waypointIndex: number;
  from: Addr;
  to: Addr;
  edits: CellEdit[];
  killedOn: number | null;
  player: Player;
  requirement: number;
}

export interface Timeline {
  tower: TowerJSON;
  initial: Player;
  steps: Step[];
  error?: SimError;
}

export interface SimInput {
  tower: TowerJSON;
  gemsOwned: number;
  route: Waypoint[];
}

export type { Cell, CellEntity, TowerJSON };
