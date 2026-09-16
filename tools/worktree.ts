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

export const PORT_LO = 5200;
export const PORT_SPAN = 2000;

// `[F]` Five dev servers were found listening on `[::1]` only, and one took a
// port another was already serving on. Binding `127.0.0.1` (vite.config.ts) is
// the fix: Vite's free-port probe and its bind then agree on one stack, so its
// walk stops stealing. Hashing only decides *where the walk starts*, so a
// session keeps the same port from one restart to the next.
//
// `[D]` A hash cannot promise uniqueness and this one does not pretend to:
// `git-route-edit-implementation` and `git-export-sav-injection` collide at
// several spans, including this one. Vite's walk is what resolves that, which is
// why `strictPort` is off — a collision costs one port, not a failed start. D47.
/** A stable starting port in `[5200, 7200)`, hashed from the worktree directory name. */
export function devPort(root = dirname(dirname(fileURLToPath(import.meta.url)))): number {
  const name = basename(root);
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return PORT_LO + (h % PORT_SPAN);
}
