# TODO.md

Outstanding actions. App version **v0.7-455**.

Aggressively pruned: anything the game source has answered is deleted from
here, not archived. The answers live in `GAME_MECHANICS.md` and the specs.

---

## A. Next action

**The simulator is implemented and both primary oracles pass** — 326/326 replay
clean, 14/14 hi-scores exact (`RESULTS.md`). SPEC-006 (the `.sav` codec) landed
with it. So the next action is no longer a correctness question:

1. **Start the app.** `src/` holds only the pure modules; there is no UI, no
   Vite setup, and no route editor. `DESIGN_ROUTE_EDITING.md` is the deferred
   sketch to promote into a spec when that begins.
2. ~~SPEC-005 (map diff)~~ **done** — 62 040 cells across all 14 towers with
   saves, zero differences. All three of SPEC-004's oracles now run.
3. **Floor entry thresholds** — the analysis `STATUS.md` names as the whole
   point of the tool. The simulator can now answer it and nothing depends on
   further reverse-engineering.

## A2. Next session — the interactive UI begins

`[D]` First deliverable is deliberately small: a **save-file visualiser**. Load a
`.sav`, pick a record, and scrub back and forth through the undo history. No
editing, no analysis, no route construction. That is the whole scope, and it is
the right first slice because everything under it already exists and is
validated — the codec reads the file, the simulator produces the timeline, and
`Cursor.seekTo` is specified for exactly this (SPEC-004 §8).

To discuss when it starts: framework setup (Vite + React per `STATUS.md`), how a
floor is drawn, and whether the scrubber moves by **step** or by **waypoint** —
the timeline is at move granularity and the route at waypoint granularity, and
`Step.waypointIndex` maps between them.

`DESIGN_ROUTE_EDITING.md` is the deferred sketch for the *editing* work that
comes after; it is not in scope for the visualiser.

## A3. ~~Map export collateral to capture~~ — done 2026-08-29

All fourteen towers with saves are captured. The longest save in each tower by
undo-history entries was exported and dropped into
`data/reference/maps/tests/`, named `<tower-id>.<save record>.png`; the suite
found them with no code change and **all sixteen pass with zero differences**
(`RESULTS.md`). Both near-misses were re-exported at the longer record, and the
two originals were kept as extra fixtures — hence 16 exports for 14 towers.

The oracle now covers **62 040 cells over 292 floors**, against the 12 622 it
started with. Regenerate the longest-save table any time with:

```
npx tsx tools/sav/longest-per-tower.ts data/saves/iestyn.2026.08.28
```

`[P]` What remains uncaptured is a **`before` export** — one taken immediately
after restarting a tower — which would enable SPEC-005's two-image diff (§5)
alongside the single-image check. The single-image check is the stronger of the
two and needs no baseline, so this is a nice-to-have, not a gap. Towers 2-6 and
3-1 have no saves at all (B3), so nothing to export there.

## B. Loose ends from the oracle work

| # | What | Why it matters |
|---|---|---|
| B1 | **Save *writing* from TypeScript is not byte-exact.** Node's zlib reproduces only 82 of 326 of the game's compressed streams at any level; the payload underneath is exact in all 326. | Blocks nothing today — reading is unaffected and writing stays on the Python codec. But byte-comparison against a hand-played save is how D17 and the pop-up encoding were settled, so it must be restored before we write saves from TS. SPEC-006 §6. |
| B2 | **The `crown` file is needed after all.** | Corrected 2026-08-28: `royal_boon1` *is* obtainable — `level_scripts.lua` injects it into 1-6 floor 25 directly beneath that tower's Dark Crown, and iestyn's 1-6 hi-score run ends on that exact cell, so he has it. With the boon set, `gemsOwned` = grade gems **+ the sum of per-tower crown tiers**, which only the `crown` file supplies. It also independently confirms which hi-scores were doubled. |
| B4 | **The `unlocks` file: not needed.** | It holds the boon flags, the seen-floor set (for map-view filtering) and the compendium flags. The only part that affects simulation is `royal_boon1` / `royal_boon2`, and both are derivable from the `crown` file: you can only have collected a boon by reaching the crown it sits under. The rest is presentation state. |
| B5 | ~~Beating 2-6 will invalidate the corpus.~~ **Answered: it will not.** | Simulated both ways with `royal_boon2` hypothetically unlocked: **326/326 still replay clean.** And the reason is structural rather than lucky — across the 11 towers with Rapier scripts, **no route ever enters any of the 59 cells a script edits**. The vaults are sealed regions holding nothing until the boon opens them, so no route ever had a reason to go there. Asserted by `test/sim/levelScripts.test.ts`. Go and beat 2-6. |
| B3 | **Tower 2-6 and 3-1 have no saves.** 2-6 is 75 floors and unplayed; 3-1 is the only tower with orbs, which SPEC-004 §1 does not model. | The sweep covers 14 of 16 towers. 3-1 needs the orb work before a save would help; 2-6 needs only play. |

## C. Experiments — all four run and passed

C1-C4 were played on 2026-08-28 and all four confirmed the simulator. Results
and the exact numbers are in `RESULTS.md`; the saves are in
`data/saves/tests/` and asserted by `test/sim/experiments.test.ts`.

The one that changed a belief: **C4**. The Hyper Pickaxe is *not* spent in
preference to an ordinary Pickaxe on a Weak Wall — the ordinary one goes first.
This had already been settled by the corpus before the test was played (flipping
the rule drops the sweep to 324/326), which is worth remembering as a method:
**a large corpus of real routes is itself a discriminating oracle.**

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
