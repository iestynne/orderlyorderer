# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**Implement SPEC-004: the simulation engine.** Draft 6 is ready and every open
item it had is closed. It carries its own §11 Verification Contract with the
expected values already measured, so nothing here repeats it.

One thing SPEC-004 needs that does not exist yet:

- **A TypeScript `.sav` codec.** `tools/luajit_buffer.py` is Python, so
  `npm test` cannot run SPEC-004's two primary oracles at all. Needs its own
  small spec. `SAVE_FORMAT.md` is complete and the Python codec becomes the
  differential test. See SPEC-004 §11.

Then: SPEC-005 (map diff), which is SPEC-004's oracle 3 and is written.

## B. What iestyn needs to provide

Not tests — collateral. This is the whole critical path for the oracles.

| # | What | Why |
|---|---|---|
| B1 | **All `.sav` files** | SPEC-004 oracle 1, the zero-error replay sweep. The primary regression net. Stays outside git; tests take a path (D14b). |
| B2 | **The `score` and `crown` files** | SPEC-004 oracle 2, the hi-score check. Both live in the game's save folder, have **no extension**, and are named **singular** — not `scores`. |

## C. Experiments still worth running

Short list, and it is short because reading the source answered the rest. Each
of these confirms we are reading the *right* code path, which reading cannot
do for itself.

| # | Test | Why it survives |
|---|---|---|
| C1 | **Load `1-5.SUFFICIENT-POWER.sav`** | The one fixture in `data/saves/tests/` never actually run (`RESULTS.md`). Free — the file exists. Positive control isolating the power comparison. |
| C2 | **Keysmasher, 2 Light + 3 Dark keys, kill a 5-power enemy** | Expect power **+11**, not +6. Every downstream power number depends on the bonus being *added to* the base, and the HUD shows only the bonus, so this is the one number worth seeing with your own eyes. |
| C3 | **An EX-3 run touching a Dark Key, then a Dark Gate, then a Keysmasher kill** | `negative_keys` was only just discovered (`GAME_MECHANICS.md` §4.1) and rewrites the whole key system. Nothing in the corpus exercises it. Expect the Dark Key to *decrease* the single key counter below zero. Highest value of the three. |
| C4 | **Weak Wall while holding both a Pickaxe and a Hyper Pickaxe** | Expect the **ordinary** Pickaxe to be spent and the Hyper Pickaxe retained. Reading an `elseif` the wrong way round would invert this and silently over-spend the scarce item. |

Everything else previously listed here is **answered by the source** and needs
no play:

- ~~One-way traversal recording, and whether the pathing checkbox must travel
  with a shared route.~~ **No.** The loader detects a barrier at the target cell
  and places the player there directly, skipping validation entirely
  (`save_manager.lua:629-654`). Replay never consults the setting, so it is
  editor-only. This retires the former "highest priority, and free" item.
- ~~Battle Gate opened at a distance by a kill.~~ One kill decrements **every**
  gate on the floor, wherever it is, and opens each that reaches 0.
- ~~Verify the Adamantine Shield rounds up.~~ It does not; it is signed floor.
- ~~Pather fallback test.~~ Moot: the loader has no fallback to test.
- ~~Is picking up a held item optional?~~ No. Pickup is unconditional.
- ~~Hyper Pickaxe: consumable or passive?~~ Consumable.

## D. Ask the developer

- **Agree the wording of the "unofficial" notice.** He has asked for one and
  said he needs to research what it should look like. A draft is in
  `DECISIONS.md` D14b-1 to give him something concrete to react to.
- **Confirm that publishing tower JSON is fine.** It is a text dump of every
  level's contents, derived from `res/maps/*`. Our position is that it is
  equivalent to what any player sees in game and carries no secret, but it is
  his level design in machine-readable form, so worth asking as a courtesy.
  **This gates `data/towers/`, which is already committed** — the one item here
  with a live consequence.
- **Would a public repo containing the sprite files be acceptable**, or should
  assets stay outside the repo with the build pulling from them? The second is
  the safe default and is what we are doing regardless.
- Minor: `entitydef.orb_change.compendium_header` reads "Warp orb", duplicating
  `orb_warp`. Looks like a copy-paste slip.

## E. Still unread in the source

Deliberately deferred, not forgotten. All are out of scope for v1 (SPEC-004 §1).

- **Orb effects** — `game.lua`. Also the meaning of the two extra values in an
  orb 5-tuple. Orbs occur in tower **3-1** only, 60 entities.
- **Rapier of the Rulers** — the combat formula is read
  (`GAME_MECHANICS.md` §5.3); what remains is how `royal_boon2` injects it.
- One unidentified sprite on 1-5 floor 1, at `(1,4)` and `(15,4)`.

## F. Standing habits

- **State the app version with every new batch of game data.** Main menu, bottom
  left. Steam auto-updates in the background.
- Claude asks for it if you forget.
- Send images inside a **ZIP** — bare `.png` uploads get transcoded to JPEG.
