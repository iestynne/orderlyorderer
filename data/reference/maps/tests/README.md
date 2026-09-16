# Map export fixtures

Final-state map PNGs exported from the game, used by SPEC-005's golden oracle
(`test/mapdiff/golden.test.ts`).

## Naming

```
<tower-id>.<save record name>.png
```

The test parses the filename to find its own inputs: the tower JSON in
`build/towers/v0.7-455/` (built, not committed), and the named record inside
`data/saves/iestyn.2026.08.28/<tower-id>.sav`. Adding a fixture therefore needs
no code change — drop the PNG in and the suite picks it up.

## How to produce one

1. Load the named save in the game, so the route is replayed to its end state.
2. Export the map image.
3. Save it here under the naming scheme above.

`[F]` Exports are lossless palette-mode PNG. **Transfer them inside a ZIP** —
a bare `.png` upload has been transcoded to JPEG once before, which destroys
exact comparison in a way that looks like it works (SPEC-005 §2). The decoder
names a JPEG explicitly rather than failing obscurely.

## What is not here yet

A `before` export — one taken immediately after restarting a tower — would
enable SPEC-005's two-image diff (§5) alongside the single-image check (§5.2).
The single-image check is the stronger of the two and needs no baseline, so this
is a nice-to-have rather than a gap.
