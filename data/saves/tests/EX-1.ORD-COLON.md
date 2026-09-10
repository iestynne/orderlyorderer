# EX-1.ORD-COLON — does the game accept a name its keyboard cannot type?

`[F]` **Run 2026-09-09 by iestyn: all six checks pass.** Results below. Built
by `tools/sav/make-probe.ts`, which must keep reproducing these exact bytes.

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

`[F]` iestyn, 2026-09-09. **The colon is safe, and `ORD:` is settled as the
export prefix.**
1. the two injected saves open fine
2. confirmed
3. they sort to the bottom; my original saves start with AUTOSAVE or numbers
4. the 24-char name perfectly fits the name-edit box
5. both ORD saves load and play, though they are empty (zero actions)
6. delete functions fine (and persists across steam cloud backup/restore)


`[F]` **5 is the expected answer, not a defect.** Both probes carry
`AUTOSAVE_EXIT`'s route, which is genuinely 1 entry — the `2S+1` rule with
S = 0, a start square and no actions. Nothing was lost in the injection. It
does mean this file never exercised a substantial payload, which is what
`EX-1.ORD-FFLATE.sav` is for.

`[F]` **3 also answers a question we had not asked**: `ORD:` rows sort to the
bottom, because `:` is 0x3A and every existing name starts with a digit or an
uppercase letter. So injected routes gather in one place in the menu rather
than scattering through it.
