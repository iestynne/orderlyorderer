// "What would obtaining royal_boon2 do to my existing routes?"
//
// Replays the whole corpus twice -- once as the account actually is, once with
// royal_boon2 hypothetically unlocked -- and reports which records stop
// replaying. This is the question TODO B5 raises, answered from data rather
// than from reading the Lua and worrying.
//
//   npx tsx tools/sav/whatif.ts <save-dir>

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { parseScoreFile } from "../../src/sav/score";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { applyLevelScripts, type AccountState } from "../../src/sim/levelScripts";
import type { TowerJSON } from "../../tools/maps/types";

const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");

function main(): void {
  const dir = process.argv[2]!;
  const crownTier = parseScoreFile(readFileSync(join(dir, "crown"), "utf8"));
  const unlocks = readFileSync(join(dir, "unlocks"), "utf8");

  const actual: AccountState = {
    royalBoon1: /^royal_boon1$/m.test(unlocks),
    royalBoon2: /^royal_boon2$/m.test(unlocks),
    crownTier,
  };
  const hypothetical: AccountState = { ...actual, royalBoon2: true };

  console.log(`\naccount as it is:  royal_boon1=${actual.royalBoon1}  royal_boon2=${actual.royalBoon2}`);
  console.log(`crown tiers: ${[...crownTier.entries()].filter(([, v]) => v === 2).length} Dark Crown, ` +
    `${[...crownTier.entries()].filter(([, v]) => v === 1).length} Crown\n`);

  for (const [label, account] of [["actual", actual], ["with royal_boon2", hypothetical]] as const) {
    let clean = 0;
    const broken: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
      const towerId = basename(f, ".sav");
      const base = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;
      const tower = applyLevelScripts(towerId, base, account);
      for (const rec of parseSaveFile(new Uint8Array(readFileSync(join(dir, f)))).records) {
        if (hasOrbMoves(rec)) continue;
        const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
        if (t.error) broken.push(`${towerId}/${rec.name}: ${t.error.code} at (${t.error.at.z},${t.error.at.x},${t.error.at.y})`);
        else clean++;
      }
    }
    console.log(`${label.padEnd(18)} ${clean} clean, ${broken.length} broken`);
    for (const b of broken.slice(0, 20)) console.log(`    ${b}`);
    if (broken.length > 20) console.log(`    ... and ${broken.length - 20} more`);
  }
}

main();
