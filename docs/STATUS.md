# STATUS.md

Paste this at the start of a fresh conversation. App version **v0.7-455**.

---

## What this project is

**Orderlyorderer** — a static web app for planning, recording and sharing routes
through towers in *Towers of Scale*, a Love2D puzzle roguelike. The name is a nod
to tower 2-5 *The Orderly Order*, and to the fact that the tool is fundamentally
about reordering things. TypeScript + Vite + React, no
backend, with a pure simulation module. The app must reproduce the game's
mechanics exactly; the oracle is that an app-generated savegame replays in the
real game and reaches the predicted state.

## What the tool is for

Not solving routes — **making a human's search less laborious**. The player
builds and edits the route; the app supplies visualisation and editing
affordances, plus small, predictable automations.

The highest-value analysis identified so far is **floor entry thresholds**: the
minimum power needed to enter and clear a region, given held items. Tower 2-5
*The Orderly Order* is built entirely around working out the order to tackle
floors in, and that computation is tedious by hand and trivial for a simulator.
The Adamantine Shield case is a good example — it lowers the threshold of a
`-N`/`+N` enemy pair from `> 2N` to `> 1.5N`, which is easy to miss manually.

## Canonical documents

| Doc | Holds |
|---|---|
| `GAME_MECHANICS.md` | Game rules: enemies, terrain, gates, held items, scoring, reachability |
| `SAVE_FORMAT.md` | Savegame container and payload, fully reverse-engineered |
| `EXTRACTION.md` | Map-export geometry and the cell-hashing pipeline |
| `SPRITES.json` | 41 sprite hashes to entity names |
| `DECISIONS.md` | Every settled decision, with rationale |
| `RESULTS.md` | Outcomes of savegame validation experiments |
| `TODO.md` | Outstanding actions |
| `luajit_buffer.py` | Working, verified codec for `.sav` files |

Each spec names which docs to load. Do not load them all.

## Done

- **Savegame format fully decoded.** Container, count encoding, payload, the
  `2S+1` rule. A parse/emit round trip reproduces all four available `.sav`
  files byte-for-byte.
- **Savegame writing works.** Nine test variants generated and loaded by the
  game. One is byte-identical to a hand-played save.
- **The loader validates by re-simulation.** Three insufficiency tests (power,
  gold, keys) were each refused. So a successful load is strong evidence our
  simulator agrees with the game's — the primary oracle is confirmed.
- **Map-export geometry established** and verified pixel-exact on 14 towers.
- **Cell identification works.** 36 distinct cell types in tower 2-1, all named.
- **All 10 enemy tiers identified** from the reference row on 2-1 floor 4.

## Game source code is available

The developer has granted access to the game's source and assets **for use in
this tool only — not for redistribution**. A Love2D executable is a ZIP
container, so the Lua source and texture atlases can be unpacked with standard
tools.

This changes how open questions should be answered: **read the source rather
than running experiments**. Mechanics questions in `GAME_MECHANICS.md` §9,
sprite identification, and the orb 5-tuple can all be settled by reading, and
far more reliably than by inference from save files.

Experiments retain one role the source cannot fill: confirming that our
*understanding* is right. A passing round-trip against the real game still
catches misreadings of the source.

## Not started

Everything in the app itself. No code has been written.

## The image-extraction track is superseded

`res/maps/` in the game archive contains the **complete, authoritative
definition of every tower** as plain line-based text: metadata, per-floor wall
grids, entity lists with values, and tutorial textboxes as explicit
`x y w h text` records. `leveldata.lua` is the reader.

Consequences:

- **SPEC-001 (overlay rectangle detector) is cancelled.** Overlays are declared,
  not inferred.
- **Map-image extraction is no longer on the critical path.** It was only ever a
  way to recover data we now have directly, and in better form — the images lose
  information the source keeps (exact values above 999, cells under the player,
  cells under overlays).
- `EXTRACTION.md` and `SPRITES.json` are **demoted, not deleted**. They remain
  the basis for the final-state diff oracle, which reads a mid-run map export to
  check simulator output. Much lower priority.

## Next

**SPEC-002: parse `res/maps/*` into tower JSON.** Not yet written.

The format, from `leveldata.lua`:

```
name                      e.g. "1-1: Training Tower"
crowns_needed
challenge                 e.g. "*"
size                      e.g. "**"
flags                     bit 1 negative_keys, 2 uncapped_elixirs,
                          4 non_persistent_items_ex_4
start_power
start_floor start_x start_y
grades C, B, A, S, star, overscore     (6 lines)
floor_count
  per floor:
    name                  e.g. "B5F: Dark Crown"
    bgm
    15 lines x 15 tokens  walls[x][y]
    entity_count
      "x y type value_str"   1-based (x, y); value_str e.g. "10k", "1M"
    textbox_count
      "x y w h text"         "||" encodes a newline
```

After that: the tower JSON schema, then the simulator.

## Known blockers

None. Everything needed to build the simulator is now in hand.
