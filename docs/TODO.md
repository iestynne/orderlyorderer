# TODO.md

Outstanding actions. App version **v0.7-455**.

---

## A. Next action

**Write SPEC-002: parse `res/maps/*` into tower JSON.** SPEC-001 is cancelled —
see `STATUS.md`.

Design questions to settle first:

1. **Wall grid encoding.** `walls[x][y]` holds small integers. Confirm the
   mapping against `leveldata.lua` (0 empty, and wall / reinforced_wall /
   iron_wall for the three wall tiers).
2. **Entity type vocabulary.** 72 sprite names in `res/sprite/`, not all of them
   tiles. Extract the authoritative set from `entitydef.lua` (1240 lines) rather
   than from filenames.
3. **`util.convert_value_str`** parses "10k", "1M". Reproduce it exactly,
   including any rounding.
4. **Tower JSON schema**, including the content hash for version detection (D9).
5. Whether to embed all towers in the app bundle or fetch per tower.

## B. Savegame experiments — remaining

| # | Test | Why |
|---|---|---|
| B1 | `1-5.SUFFICIENT-POWER.sav` — two Slimes beaten by raw power | Positive control, isolates the power comparison |
| B2 | `1-5.VORPAL-BLADE.sav` | Held item defeats an enemy power could not |
| B3 | One-way wall traversal, checkbox ON then loaded with it OFF | `SAVE_FORMAT.md` 3 predicts a pair **is** recorded. If not, the setting is route metadata that must travel with shared routes. |
| B4 | Battle Gate opened at a distance by a kill | Confirms one transition changes multiple tiles |
| B5 | ~~Hand-play a one-way traversal~~ | **Half done.** Step-ON is confirmed *not* recorded. See `SAVE_FORMAT.md` 5.2. |
| B5a | ~~One-way traversal onto an empty tile~~ | **Done.** Not recorded at all. See `SAVE_FORMAT.md` 5.2. |
| B5b | **Load `1-5_ONE-WAY-ENCODING-2.sav` with the one-way pathing checkbox OFF** | Highest priority, and free — the save already exists. Its replay requires crossing a one-way. If it fails to load, the setting is confirmed as route metadata that must travel with shared routes. If it loads, replay ignores the setting and only the editor needs to care. |
| B6 | **Verify the Adamantine Shield rounds up**, and whether it halves gains too | `GAME_MECHANICS.md` 9.3 |
| B7 | **Pather fallback test** — needs a pickaxe to open an alternate route first, since by design no such choice exists until the player creates one | **Low priority.** Outcome near-certain (the pather takes the unobstructed route), and moot if B5 shows traversal is always recorded. |

Deferred by decision until all towers are scanned.

## B2. Read before writing the simulator

- `game.lua` (2142 lines) — orb effects, movement, the Pop-Up step-off
  conversion, held-item precedence.
- `util.convert_value_str` — port exactly.
- The draw code — confirm the wall-value mapping 0/1/2/3.

## C. New mechanics found in the source, now partly documented

Sprite names reveal entities never discussed:

- **Orbs** are counters, not held items. Pickup is a normal recorded
  interaction; *using* one produces a 5-tuple. Effects still unread.
- **Royal boons** change tower contents and gem budgets — see
  `GAME_MECHANICS.md` 10. This is the significant one.
- **`gate`** = Half Gate, **`door2`** = Dark Gate, **`gem`** = UI only.
  **`rapier`**, **`time`** still open.
- Tower flags: **`negative_keys`**, **`uncapped_elixirs`**,
  **`non_persistent_items_ex_4`** — per-tower rule variations we did not know
  existed. These affect the simulator directly.

`GAME_MECHANICS.md` is therefore **incomplete**, not merely uncertain. Read
`entitydef.lua` (1240 lines) and `game.lua` (2142) before writing the simulator.

## D. Answer from the source, not by experiment

The game source is available (see `STATUS.md`). Read it for:

- The mechanics questions in `GAME_MECHANICS.md` 9 — Hyper Pickaxe class,
  Adamantine Shield rounding, Spikes entry threshold.
- The meaning of the two extra values in an **orb** 5-tuple (tower 3-1).
- Whether the pather's one-way handling is fallback-only (B7 becomes trivial).
- The exact tile-state model, which settles the Pop-Up vs one-way asymmetry.
- Sprite identification, from the texture atlas, replacing the hash corpus.

## C2. Ask the developer

- **Agree the wording of the "unofficial" notice.** He has asked for one and
  said he needs to research what it should look like. A draft is in
  `DECISIONS.md` D14b-1 to give him something concrete to react to.
- **Would a public repo containing the sprite files be acceptable**, or should
  assets stay outside the repo with the build pulling from them? The second is
  the safe default and is what we are doing regardless.
- **Confirm that publishing tower JSON is fine.** It is a text dump of every
  level's contents, derived from `res/maps/*`. Our position is that it is
  equivalent to what any player sees in game and carries no secret, but it is
  his level design in machine-readable form, so worth asking as a courtesy.

Also worth mentioning: `entitydef.orb_change.compendium_header` reads "Warp orb",
duplicating `orb_warp`. Looks like a copy-paste slip.

## D. Questions for the developer — mostly answered

Answered: saves are move history only, replayed and validated on load; Pop-Up
tiles are queued on step-**onto**; there is no tower versioning; entries can be
5-tuples for orbs; serialization is the LuaJIT string buffer library. All match
our reverse-engineering.

Still open:

- **Is there an in-game screenshot key?** Love2D exposes
  `love.graphics.captureScreenshot`. Less urgent now the atlas is available.
- **Is picking up a held item optional?** Highest-priority mechanics question:
  if not, a tile holding an item is impassable while carrying a passive.
- **Hyper Pickaxe**: consumable or passive?
- **Identify one remaining sprite on 1-5 floor 1**, at `(1,4)` and `(15,4)`.
  Spikes `(3,13)` and Player `(8,14)` are now in `SPRITES.json`.
- Remaining mechanics questions — see `GAME_MECHANICS.md` 9.

## D. Data still needed

- Compendium pages covering **Held Items** and **special tiles**.
- Sprite names for cell types that appear only on tutorial-overlay floors of 2-1
  (**Master Key** is one). Blocked on SPEC-001.
- Sidebar UI screenshot — needed for the exact player-power display.
- A clean integer-scaled UI capture, or the atlas from the developer.

## E. Standing habits

- **State the app version with every new batch of game data.** Main menu, bottom
  left. Steam auto-updates in the background.
- Claude asks for it if you forget.
- Send images inside a **ZIP** — bare `.png` uploads get transcoded to JPEG.

---

## Done

- Savegame container, count encoding and payload fully decoded; byte-exact round
  trip on all four `.sav` files.
- Savegame writing verified: nine variants generated, all loaded, one
  byte-identical to a hand-played save.
- Loader confirmed to validate by re-simulation (power, gold, keys all refused).
- Pop-Up Wall encoding settled: the move **onto** the tile is recorded.
- The `2S+1` rule reframed: recorded pairs are the moves the auto-pather cannot
  reproduce, not the moves that change state.
- Map geometry, hash band and overlay contamination understood.
- All 36 cell types in 2-1 named; all 10 enemy tiers identified; Pop-Up Wall
  added. `SPRITES.json` at 41 entries.
- Negative-variant derivation rule validated as a candidate generator (exact for
  some tiers, off by 1–3 px for others — never use it to invent an unseen
  sprite).
- Floor counts, panel ordering and unused-slot placement confirmed.
- Tower names confirmed; score thresholds deferred by decision.
- File naming and organisation conventions agreed (`DECISIONS.md` D14–D17).
