# SPEC-003 (STUB) — Headless rules harness

**Status:** stub. Not scheduled. Flesh out only if the decision gate below is met.
**Docs to load when written:** `SAVE_FORMAT.md`, `GAME_MECHANICS.md`.

---

## Goal

Run the game's own Lua rules code headlessly, so that differential testing
against our simulator becomes a script rather than a person playing.

```
harness  <tower-id>  <save-file>  <save-name>   ->  final state as JSON
```

Then: feed the same route to the game's code and to ours, diff the outputs. No
playing, no screenshots, no manual verification.

## Why it might be worth it

Manual verification is currently the project's slowest step and its only check
on simulator correctness. Every rules question so far — pop-up encoding, one-way
recording, spike thresholds — cost a round trip through a human playing the game.
A harness turns those into unit tests.

It is also the only oracle that scales. Verifying one route by hand is fine;
verifying a fuzzer's output is not.

## Why it might not be

`game.lua` is 2142 lines and mixes rules with rendering, input and audio. If the
rules cannot be separated cleanly, the harness becomes a fork that drifts from
the real game — which is worse than no harness, because it would look
authoritative while being wrong.

## Feasibility, from a first read

Encouraging:

- `util.lua` — 159 lines, 7 `love.*` references. Essentially portable as-is.
- `entitydef.lua` — 1240 lines, 59 `love.*` references, **all of them
  `newImage` at load time**. A stub returning a dummy object satisfies every
  one. The interaction logic itself is pure.
- `leveldata.lua` — needs `love.filesystem.lines`, trivially stubbed with a real
  file reader.

Unresolved:

- `game.lua` — the movement loop, orb effects and held-item precedence live here
  alongside all the drawing. Separability unknown; this is the whole risk.
- Globals: `g_sfx`, `unlocks`, `achievements`, `Scores`, `log`. All look
  stubbable, none verified.
- The game runs on LuaJIT. The harness should too, since the save format is
  LuaJIT's own serializer and reusing it removes a whole class of bug.

## Sketch

1. `love_stub.lua` — minimal `love.graphics` / `audio` / `filesystem` shims.
2. Load `util`, `entitydef`, `leveldata` unmodified. **Never fork them**; if a
   module needs changing to load, stub harder instead.
3. Drive the rules: build the tower, replay a save's undo history, halt.
4. Dump final state as JSON — tower grid, entity list, player position, power,
   gold, keys, held item, orb counts.

Constraint: the harness may **read** game source but must never modify or vendor
it. It is a test fixture, not a dependency, and it must not end up in a public
repository (D14b).

## Decision gate

Build this only when **both** hold:

1. The simulator exists and passes the reference saves, so there is something to
   differentially test.
2. Manual verification has actually become the bottleneck — not merely predicted
   to.

Until then the cheaper path is reading the source directly, which has answered
every question put to it so far at a fraction of the cost.

## Verification contract (sketch)

- For each reference save: harness output matches our simulator's, field for
  field.
- For each `INSUFFICIENT-*` fixture: the harness rejects the route, as the real
  game does.
- Fuzzed routes: harness and simulator agree, or the disagreement is reported
  with the first diverging transition.
