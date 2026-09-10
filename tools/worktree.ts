// Which worktree this is, from its own directory name.
//
// `[F]` Every session runs its own dev server (CLAUDE.md §2), so several are up
// at once on whatever ports Vite finds free, all serving the same `index.html`.
// The topic name in the URL path is what tells them apart — in a browser tab and
// to the screenshot harness, which otherwise cannot tell a sibling's server from
// its own (`tools/shots/run.ts`).

import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** `git-<WTTN>/` serves at `/<WTTN>/`; the merge target `git/` serves at `/`. */
export function basePath(root = dirname(dirname(fileURLToPath(import.meta.url)))): string {
  const wttn = basename(root).replace(/^git-?/, "");
  return wttn === "" ? "/" : `/${wttn}/`;
}

/** The same as a prefix an absolute path is appended to: `/<WTTN>`, or `` for `git/`. */
export const sitePath = (): string => basePath().slice(0, -1);
