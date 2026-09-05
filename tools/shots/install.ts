// SPEC-009 §2 — the one command in this repository that reaches the network,
// and the only one iestyn runs by hand.
//
//   npm run shots:install
//
// `[D]` A script rather than a bare `npx playwright-core install chromium`,
// for two reasons. `PLAYWRIGHT_BROWSERS_PATH` has to be set for the install to
// land in the project's own gitignored `.browsers/` rather than in the user's
// home directory, and an npm script cannot set an environment variable in a
// way that works on both Windows and POSIX. And an agent must never run this:
// `CLAUDE.md` forbids reaching off localhost during a task, so the command
// says out loud what it is about to do.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { BROWSERS_PATH } from "./browser";

const cli = createRequire(import.meta.url).resolve("playwright-core/package.json").replace(/package\.json$/, "cli.js");

console.log(`Downloading Chromium into ${BROWSERS_PATH}/. This reaches the network.`);
console.log("Nothing else in this repository does, and no ordinary npm script does.\n");

const r = spawnSync(process.execPath, [cli, "install", "chromium"], {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH },
});
process.exitCode = r.status ?? 1;
