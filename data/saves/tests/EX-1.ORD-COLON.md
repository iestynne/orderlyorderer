# EX-1.ORD-COLON — does the game accept a name its keyboard cannot type?

`[O]` **Not yet run.** Built 2026-09-09 by `tools/sav/make-probe.ts`.

## What it is

`EX-1.sav` as played, plus two injected records. Nothing else differs: byte 0
is unchanged, byte 1 is the record count (10 → 12), and bytes 2..EOF of the
original are present verbatim at their own offsets. 10 186 bytes, +153.

| Name | Chars | Asks |
|---|---|---|
| `ORD:probe` | 9 | Does a colon survive the save menu at all? |
| `ORD:78901234567890123456` | 24 | Does a name at the input limit fit the 188px box? |

`[F]` Both replay record 0's route (`AUTOSAVE_EXIT`), so either one loading is
evidence the injected name did not disturb the payload beside it.

`[F]` **The colon is unreachable from the game.** `save_manager.lua:327-352`
accepts 24 of `A-Za-z0-9 !#$%&'()+-@[]^_\`{}~.` and nothing else. That is why
`ORD:` is proposed as the prefix: no hand-typed save can ever collide with one.
This file asks whether the game *displays and loads* what it cannot *type*.

## How to run it (D16)

Copy over `%APPDATA%/LOVE/towers_of_scale/savestates/EX-1.sav`, having backed
that file up first. **Never rename this file to `EX-1.sav` in place** — deliver
a variant under an original's name and a real save is one mistake from gone.

## What to look for

1. The savestate menu opens without a "Load failed" dialog.
2. **12 rows**, the 10 originals unchanged.
3. Where the two `ORD:` rows sort. `reload_saves` does `table.sort`, so they
   land by byte value — `:` is 0x3A, above `9` and below `A`.
4. Whether the 24-char row overflows its box, and whether its timestamp column
   still reads `2026-09-09 18:30`.
5. `ORD:probe` loads and plays.
6. Delete works on an `ORD:` row (the player's only way to remove one).

## Result

`[O]` Unfilled. Record what happened here, with a screenshot reference, and
turn the `[O]` above into `[F]`.
