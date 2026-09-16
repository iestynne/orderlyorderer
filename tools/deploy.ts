// Publish the built app to GitHub Pages.
//
// `[D]` There is no Actions workflow, and cannot be one: the build reads the
// game archive in `../local/` (D14b, D29), which a runner will never have. So
// the site is built here and only the bundle is pushed, to an orphan
// `gh-pages` branch that Pages serves. The art is inlined into the bundle
// rather than emitted as files (SPEC-007 §6.1), so no raw asset is ever
// committed — and deploying the built app is the arrangement the developer
// prefers (D14b-1).
//
// `[F]` **Only iestyn runs this.** With `npm run shots:install` it is one of
// the two commands in this repository that reach the network (CLAUDE.md).

import { execFileSync } from "node:child_process";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PAGES = "build/pages";
const BRANCH = "gh-pages";

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

/**
 * `/<repo>/` — the sub-path a GitHub project site is served from, from the
 * remote URL in either form. `[F]` A build at the wrong base shows as a black
 * canvas, not an error (SPEC-007 §6.1), so it is derived, never typed.
 */
export const repoBase = (remote: string): string =>
  `/${remote.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop()}/`;

function deploy(): string {
  const base = repoBase(git("remote", "get-url", "origin"));
  // `[F]` Set here rather than in the shell: a POSIX shell on Windows rewrites
  // a leading-slash value into a drive path, and `BASE_PATH=/orderlyorderer/`
  // arrives as `/Program Files/Git/orderlyorderer/`.
  execFileSync("npm", ["run", "build"], { stdio: "inherit", shell: true, env: { ...process.env, BASE_PATH: base } });
  writeFileSync("dist/.nojekyll", ""); // Pages runs Jekyll otherwise, which drops `_`-prefixed paths.

  rmSync(PAGES, { recursive: true, force: true });
  git("worktree", "prune");
  if (git("branch", "--list", BRANCH) !== "") git("branch", "-D", BRANCH);
  git("worktree", "add", "--orphan", "-b", BRANCH, PAGES);
  cpSync("dist", PAGES, { recursive: true });
  execFileSync("git", ["-C", PAGES, "add", "-A"], { stdio: "inherit" });
  execFileSync("git", ["-C", PAGES, "commit", "-qm", `Deploy ${base} from ${git("rev-parse", "--short", "HEAD")}`], { stdio: "inherit" });
  return base;
}

// `--no-push` builds the branch and leaves the worktree in place to look at.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = deploy();
  if (process.argv.includes("--no-push")) console.log(`${BRANCH} built at ${PAGES}, serving ${base}. Not pushed.`);
  else {
    git("push", "--force", "origin", BRANCH);
    git("worktree", "remove", "--force", PAGES);
    console.log(`pushed ${BRANCH}; Pages serves https://<user>.github.io${base}`);
  }
}
