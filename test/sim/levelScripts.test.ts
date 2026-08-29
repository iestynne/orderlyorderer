// GAME_MECHANICS.md §9.1 — level_scripts.lua, and what obtaining royal_boon2
// would do to existing routes.
//
// The worry was reasonable: the 2-1 script RAISES ten Weak Walls to Reinforced,
// which would break any route that had dug through them. These tests establish
// that no route can be affected, and why.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScoreFile } from "../../src/sav/score";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { coords } from "../../src/sim/grid";
import { LEVEL_SCRIPTS, applyLevelScripts, type AccountState } from "../../src/sim/levelScripts";
import { SAVE_DIR, haveSaves, loadAllSaves } from "../sav/helpers";

const d = haveSaves && existsSync(join(SAVE_DIR, "crown")) ? describe : describe.skip;

function account(): AccountState {
  const unlocks = readFileSync(join(SAVE_DIR, "unlocks"), "utf8");
  return {
    royalBoon1: /^royal_boon1$/m.test(unlocks),
    royalBoon2: /^royal_boon2$/m.test(unlocks),
    crownTier: parseScoreFile(readFileSync(join(SAVE_DIR, "crown"), "utf8")),
  };
}

d("level scripts (GAME_MECHANICS §9.1)", () => {
  it("the account has royal_boon1 and not royal_boon2", () => {
    const a = account();
    // royal_boon1 sits directly beneath 1-6's Dark Crown, so taking that crown
    // collects it. royal_boon2 is on 2-6 floor 75, which is unplayed.
    expect(a.royalBoon1).toBe(true);
    expect(a.royalBoon2).toBe(false);
  });

  it("the crown file agrees with the win state the sim derives from routes", () => {
    // Two independent sources: the game's own crown file, and what our
    // simulator concludes from which crown cell each hi-score route ends on.
    const a = account();
    let checked = 0;
    for (const { file, tower } of loadAllSaves()) {
      const rec = file.records.find((r) => r.name === "AUTOSAVE_HISCORE");
      if (!rec || hasOrbMoves(rec)) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      expect(t.error).toBeUndefined();
      expect(t.steps.at(-1)!.player.win, tower.metadata.name).toBe(a.crownTier.get(tower.metadata.name));
      checked++;
    }
    expect(checked).toBe(14);
  });

  it("obtaining royal_boon2 would break none of the existing routes", () => {
    const hypothetical: AccountState = { ...account(), royalBoon2: true };
    const broken: string[] = [];
    let clean = 0;
    for (const { towerId, file, tower } of loadAllSaves()) {
      const built = applyLevelScripts(towerId, tower, hypothetical);
      for (const rec of file.records) {
        if (hasOrbMoves(rec)) continue;
        const t = simulate({ tower: built, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
        if (t.error) broken.push(`${towerId}/${rec.name}: ${t.error.code}`);
        else clean++;
      }
    }
    expect(broken).toEqual([]);
    expect(clean).toBe(326);
  });

  it("and the reason is structural: no route ever enters a script-edited cell", () => {
    // This is what makes the above safe rather than lucky. The rapier vaults
    // are sealed regions holding nothing until the boon opens them, so no route
    // ever had a reason to go there -- which is presumably the design.
    let watched = 0;
    const touched: string[] = [];
    for (const { towerId, file, tower } of loadAllSaves()) {
      const script = LEVEL_SCRIPTS[towerId]?.rapier;
      if (!script) continue;
      const watch = new Set<string>([`${script.floor},${script.entity.x},${script.entity.y}`]);
      for (const [[x, y]] of script.walls ?? []) watch.add(`${script.floor},${x},${y}`);
      watched += watch.size;
      for (const rec of file.records) {
        if (hasOrbMoves(rec)) continue;
        const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
        if (t.error) continue;
        for (const s of t.steps) {
          const { z, x, y } = coords(s.to);
          if (watch.has(`${z},${x},${y}`)) touched.push(`${towerId} (${z},${x},${y})`);
        }
      }
    }
    expect(touched).toEqual([]);
    expect(watched).toBe(59);
  });

  it("applyLevelScripts leaves its input untouched", () => {
    const { towerId, tower } = loadAllSaves().find((t) => t.towerId === "2-1")!;
    const before = JSON.stringify(tower.floors[1]!.cells);
    applyLevelScripts(towerId, tower, { ...account(), royalBoon2: true });
    expect(JSON.stringify(tower.floors[1]!.cells)).toBe(before);
  });

  it("2-1 is the only script that raises walls, and all ten are real changes", () => {
    const raised: string[] = [];
    for (const [id, s] of Object.entries(LEVEL_SCRIPTS)) {
      for (const [[x, y], v] of s.rapier?.walls ?? []) if (v !== 0) raised.push(`${id} (${x},${y})->${v}`);
    }
    expect(raised.length).toBe(10);
    expect(raised.every((r) => r.startsWith("2-1 "))).toBe(true);

    // Every one is Weak (1) becoming Reinforced (2): the vault is hardened so
    // ordinary Pickaxes cannot open it sideways.
    const t = loadAllSaves().find((x) => x.towerId === "2-1")!.tower;
    for (const [[x, y], v] of LEVEL_SCRIPTS["2-1"]!.rapier!.walls!) {
      if (v === 0) continue;
      expect(t.floors[1]!.cells[y - 1]![x - 1], `2-1 (${x},${y})`).toBe(1);
    }
  });
});
