# tools/maps — map parser

Turns the game archive's `res/maps/*` files into tower JSON. This is the
simulator's only source of tower content: image extraction was cancelled
because the source files are authoritative and lossless (D13a).

Specified by [`specs/SPEC-002-map-parser.md`](../../specs/SPEC-002-map-parser.md).
Read that for the schema (§5), the entity vocabulary (§3.2) and the
Verification Contract (§8). This README covers only how to run it.

## Usage

Run from the repository root. The archive is outside the repo (D14d); the
output directory is version-stamped by path (D15).

```
npm install
npm run parse-maps -- ../local/game/v0.7-455 data/towers/v0.7-455
```

Writes one `<tower_id>.json` per tower plus an `index.json`, and prints
`parsed 16 towers -> <out-dir>`. `game_version` is read from the archive's
`.version` file, never hardcoded (D14c-1).

This is a **build-time** step, run once per game version. Nothing in the app,
the simulator or the test suite needs the archive — they read the derived JSON
(D14e). Regenerating is deterministic: same archive in, byte-identical JSON out.

## Files

| File | Role |
|---|---|
| `cli.ts` | The only file that touches the filesystem. Reads the archive, hashes the source bytes, writes the output. |
| `parser.ts` | Pure `text -> {metadata, floors}`. Throws `MapParseError` naming tower, floor and line. |
| `emitter.ts` | Mirrors `LevelData:save()` exactly. Exists for the round-trip oracle, not to write game files. |
| `format.ts` | Reviewable JSON: one line per wall row, entity and textbox, so a tower change reads as a sane diff. |
| `types.ts` | The schema, the 41-name entity vocabulary, and the canonical tower order. |

The IO shell / pure core split is D7. Tests live in `test/tools/maps/`.

## Verification

```
npm test
```

The primary oracle is a **byte-exact round trip**: parse then emit must
reproduce all 16 source files byte for byte (16/16). This works because the
shipped files were themselves written by `LevelData:save()`, so it proves
nothing was dropped, reordered or coerced. Alongside it the suite pins the
tower inventory, per-tower `content_hash`, named cells, and the invariants in
SPEC-002 §8.

## Two traps worth knowing before editing

- **Do not transpose the walls.** The file is row-major and this schema keeps
  it that way (`walls[y][x]`, 0-based, 15x15, values 0..3 = Empty / Weak /
  Regular / Strong). The *game* indexes `walls[x][y]`; converting happens at
  the consumer boundary, not here (D1).
- **`value_str` is the source of truth, not `value`.** `convert_value_str`
  does no rounding — the lossy step is display-only — and every shipped value
  matches `^\d+[kMG]?$`, which the parser pins as an invariant rather than
  trusting.

`content_hash` is the SHA-256 of the **source map file's bytes**, not of our
JSON, whose shape is deliberately unstable until a simulator exists (D9 as
refined by SPEC-002). Hashing our own output would churn the hash on every
schema edit and report a tower-content change that did not happen.
