// SPEC-009 §2 — the one command in this repository that reaches the network,
// and the only one iestyn runs by hand.
//
//   npm run shots:install
//
// A script, not a bare `npx playwright-core install`: `PLAYWRIGHT_BROWSERS_PATH`
// must be set for the install to land in `.browsers/`, and an npm script cannot
// set an env var portably. An agent never runs this (`CLAUDE.md`).

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
