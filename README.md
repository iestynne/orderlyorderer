# Orderlyorderer

A route-planning tool for the puzzle game *Towers of Scale*: open a savegame,
scrub through a route a step at a time, edit it, and write the result back as a
save the game will load.

> Orderlyorderer is an unofficial fan-made tool for Towers of Scale. It is not
> affiliated with the developer of Towers of Scale. Game sprites are used with
> permission and remain the property of their creator.

It is not a solver. The point is to make a human's search **less laborious** —
the player builds and edits the route, and the app supplies visualisation,
affordances and small, predictable automations.

## What it does

- **Reads any savegame.** The `.sav` format is fully reverse-engineered; a
  parse/emit round trip reproduces the shipped files byte for byte.
- **Replays a route exactly.** The simulator agrees with the game across
  **326 / 326** save records over ~470 000 moves, **14 / 14** hi-scores, and
  **62 040 / 62 040** tiles of final map state.
- **Edits routes.** Insert and remove actions, disable them, fork a stretch and
  compare, and watch the consequences fall out down the rest of the run.
- **Exports back into the game.** A route is injected into a copy of your own
  save as one extra record, leaving every other byte of the file untouched.

## Requirements

**You need to own the game.** It supplies the sprites and the map data, and
neither is in this repository (see the licence note below). Without a copy of
the game archive at `../local/game/<version>/`, the build has nothing to draw.

```sh
npm ci
npm run build-atlas     # sprites  -> build/atlas.png
npm run parse-towers    # res/maps -> build/towers/
npm run dev             # or: npm run build
```

Everything is static — there is no backend, and nothing reaches the network.

## Exporting a route into your game

The browser is not allowed anywhere near the game's save folder, so the app
never touches it. Instead it writes into a folder you nominate, and you copy the
result across yourself. The export screen walks through it, and the short
version is:

1. Copy your `savestates` folder somewhere safe, with today's date in the name.
2. Export. The app writes a sibling folder holding the towers you exported,
   with your route added as one extra record.
3. With the game at the main menu, copy those files into `savestates`.
4. Load the route and check it before playing on.

Injected routes are named `ORD:…`, a prefix the game's own keyboard cannot type,
so an export can never overwrite a save you played by hand.

## Layout

```
docs/     canonical documentation. Mutable, current state only.
specs/    SPEC-NNN-slug.md. Frozen once tests exist against them.
src/      the app: sav codec, simulation, route editing, UI.
test/     the oracles, and the corpus they run against.
tools/    map parser, atlas builder, save utilities, screenshot harness.
data/     the save corpus. Committed on purpose: it is the example data.
build/    derived from the game archive. Gitignored; rebuilt by the commands above.
```

Start with **`docs/STATUS.md`**. **`SETUP.md`** covers repository setup.

## Not in this repository, by licence

Towers of Scale is **not** open source. Its source and assets are used with the
developer's permission **for this tool only**, and are never committed here or
redistributed. They live outside the repository entirely, where git cannot reach
them.

So the sprites and the tower data are **built, not published**: the scripts that
derive them are here, and running them needs your own copy of the game. What we
generate in our own words — mechanics documentation, specs, the code — is ours
and is published here.
