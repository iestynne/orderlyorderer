// Where things are, for everything that reads them from disk.
//
// `[D]` One definition, because the tower JSON has moved once already and was
// named in ten files when it did. A path spelled out at each use is a path that
// only moves by grep.
//
// `[D]` **Derived output is gitignored, not committed.** The sprites have always
// worked this way — `../local/game/` in, `build/atlas.png` out — and the tower
// JSON now matches: `res/maps/*` in, `build/towers/` out. `[I]` iestyn,
// 2026-09-15, following makiki's preference for compiling map data into the
// bundle rather than publishing it as files (D14b-1). The **scripts** stay in
// the repository, so anyone who owns the game can build their own copy.
//
// `[F]` The saves are the exception and are committed on purpose: they are
// iestyn's own files, they are useful example data, and the corpus oracles are
// built on them.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The game version every derived artefact here is stamped with (D15). */
export const GAME_VERSION = "v0.7-455";

/** The game archive. Read-only, never publishable (D14b), outside the repo (D14d). */
export const GAME_DIR = join("..", "local", "game", GAME_VERSION);

/** `npm run parse-towers` writes here; `src/ui/assets.ts` bundles from here. */
export const TOWER_DIR = join("build", "towers", GAME_VERSION);

/** The committed save corpus. `TOS_SAVE_DIR` overrides it. */
export const SAVE_DIR = process.env["TOS_SAVE_DIR"] ?? join("data", "saves", "iestyn.2026.08.28");

/**
 * Whether the tower JSON has been built.
 *
 * `[D]` Tests that need it **skip** rather than fail, the way the save corpus
 * already does: a clone without the game archive cannot produce it, and a suite
 * that went red for that would be reporting a missing input as a defect (D29).
 */
export const haveTowers = (): boolean => existsSync(join(TOWER_DIR, "index.json"));
