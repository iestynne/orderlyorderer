// A browser stand-in for the two node:zlib calls the `.sav` codec makes.
//
// SPEC-006 was written for Node and `savefile.ts` inflates with node:zlib.
// That module is frozen and byte-exact against all four shipped save files, so
// rather than reshape it, `vite.config.ts` aliases `node:zlib` here for the
// browser build only. Node keeps the real thing, and the 82 tests keep testing
// the code that actually ships to them.
//
// `[D]` fflate rather than the platform's DecompressionStream: the latter is
// async, and making it work would turn parseSaveFile -- a pure, synchronous,
// byte-exact function -- into an async one, rippling through every caller for
// no gain the user can see. fflate is ~3 KB, dependency-free and synchronous.
//
// `[F]` **Both are on the app's path now.** Export writes into the player's own
// `.sav` (`store/savefolder.ts`), so `deflateSync` here — fflate's `zlibSync` —
// is the compressor that produces every stream a player ships to the game. Not
// fflate's own `deflateSync`, which emits raw DEFLATE with no zlib header; the
// game decompresses with `love.data.decompress("string","zlib",...)` and would
// refuse that with no clue why. `test/sav/inject.test.ts` pins the header.

import { unzlibSync, zlibSync } from "fflate";

export function inflateSync(data: Uint8Array): Uint8Array {
  return unzlibSync(data);
}

export function deflateSync(data: Uint8Array, opts?: { level?: number }): Uint8Array {
  const level = opts?.level ?? 6;
  return zlibSync(data, { level: Math.max(0, Math.min(9, level)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
}
