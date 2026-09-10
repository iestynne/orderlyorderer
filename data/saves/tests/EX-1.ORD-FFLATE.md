# EX-1.ORD-FFLATE — will the game load a stream the browser compressed?

`[O]` **Not yet run.** Built 2026-09-09 by `tools/sav/make-probe.ts`.

## The question

`[F]` Every generated save the game has ever accepted came from
`tools/luajit_buffer.py`, whose zlib is byte-exact against Love2D's. The
browser ships **neither** that nor Node's: `vite.config.ts` aliases `node:zlib`
to `src/sav/zlib-browser.ts`, which is fflate. So the stream a player writes on
export is one no accepted save has ever contained.

`[F]` It should not matter. `save_manager.lua:609` decompresses with
`love.data.decompress("string","zlib",...)`, and a zlib decompressor reads any
conformant stream whoever wrote it. `[O]` But "should not matter" is the shape
of every assumption this project has caught out, and the cost of asking is one
file.

## What it is

`EX-1.sav` as played, plus **one** record: `ORD:16.6G replay`, 16 chars, holding
the 657-entry route from `16.6G win` — a real winning run, long enough that the
compressor makes real block choices rather than emitting one literal run.
11 753 bytes, +1 720. Everything else byte-identical (byte 1 aside).

`[F]` **Tested from this side already**: all 326 corpus payloads compress under
fflate and inflate back exactly under `node:zlib`, with a zlib wrapper rather
than raw DEFLATE (`test/sav/inject.test.ts`). This file is the other half —
whether Love2D agrees.

## How to run it (D16)

Copy over `%APPDATA%/LOVE/towers_of_scale/savestates/EX-1.sav`, having backed
that file up first. **Never rename this file to `EX-1.sav` in place.**

## What to look for

1. The menu opens; **11 rows**, the 10 originals unchanged.
2. `ORD:16.6G replay` loads without "Load failed".
3. It replays as a **winning run scoring 16.6G** — the same as `16.6G win`
   beside it. A stream that decompressed to something subtly wrong would more
   likely be refused outright, but a matching score is the real check.

## Result

`[O]` Unfilled. If this passes, the browser export path is proved end to end and
B1 stops being a blocker for writing saves; if it fails, 2D cannot ship from a
browser at all and the finding is worth more than the feature.
1. yep
2. yep, and I can rewind it all the way back to the start (I guess that doesnt tell us anything extra...)
3. yep