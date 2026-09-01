# UI.md

**What the app currently does**, in natural language. Current state only.

Read with `specs/SPEC-007-tower-scrubber.md`, which holds the numbers: constants
and interfaces there, observable behaviour here. Rules and the 150-line budget:
D31.

---

## 1. Shell and loading

On first run the app is only the way in: a large **Open a save file** target
that also takes a file dropped anywhere on the window. No placeholder tower,
nothing greyed out. The empty state names where saves live — that path is not
obvious — and carries the unofficial notice.

Opening a `.sav` lists its records at once: name, timestamp where there is one,
and three figures simulated behind the list, `…` until each lands — final power,
highest floor, waypoint stops. Player-named records sort above the `AUTOSAVE_*`
ones, those names being the player's own index into their play. A record using
orbs is listed but not openable, and says why.

The tower comes from the filename; if that names no tower we know, the app asks
rather than guessing. Choosing a record replaces the empty state with the two
panels, over a small toolbar: back to the save list, a **screenshot** button
writing the exact 1× frame to a PNG, and a reminder of the keys.

## 2. Timeline panel

The left panel is a horizontally scrolling strip of floors in the order the
route visits them. A floor appears once per visit, so one the route returns to
appears more than once, each tile captioned with its name and which visit it is.

A floor earns a tile only where the player **acts** on it; floors merely walked
through get none, since they filled the strip with places nothing happened. The
trail still crosses the gap in one dashed segment, so it reads as travel.

A route spends long stretches oscillating within a handful of floors, and one
tile per visit meant constant scrolling. So the route is cut into **scroll
units**: runs whose floors all fit at once — the working set is exactly the
floors that fit the visible tiles, no other threshold. Inside a unit each floor
has one tile and the strip does not move; it shifts only when scrubbing leaves
the unit. A three-floor tower is one unit, three tiles, no scrolling.

Scroll units are a **view** device: recomputed on resize, never saved, and not
the route segments of `DESIGN_ROUTE_EDITING.md`, which are the player's own and
reach into the simulation. D34.

Tiles lie in two rows, each offset half a tile-width from the last — a
bricklayer pattern, so consecutive visits never share a horizontal range and
"further right is later" is unambiguous. Every tile has a border and a gap.

At least three tiles are visible; a wider window shows more. When the strip does
move it glides, easing over about half a second and landing on whole pixels, so
floors never blur mid-flight. The captions can be switched off, which gives
their height back to the floors.

## 3. The route trail

A line runs through the route's waypoints over the floors, connecting them
directly rather than following the walked path. It crosses between tiles, so
stairs read as one continuous line; those crossings are dashed as travel.

Both halves are lavender, separated only by hue: the past shifted towards blue,
the future towards red. That shift is one tunable constant, `dHue`, not yet
settled. Both carry a black outline, and both fade to nothing two stops either
side of the scrub position — a narrow reminder, not a whole-route overlay.

The future draws before the past and the segment at the scrub position draws
last, so the tenses never interleave. The player is drawn at the current
waypoint in the state *after* that action, with its power beneath it.

## 4. Control panel

The right panel holds a fixed shape at any window size while the left panel
takes the rest. It is headed, as the game is, with the tower name over the
floor name.

**Scrub slider.** Vertical, running **upward**: the first action is at the
bottom, as floor 1 is in the stack beside it. It stops once per action plus once
at the final position — not once per simulated step, a pathfinder detail far too
numerous to be useful. Ticks mark floor changes; a counter reads which action you
are on. The handle is an hourglass on its side, crossing the track at its waist:
wide enough to grab, pinched so it never hides its tick.

**Tower stack.** The whole tower as a vertical stack of floors, each squashed
and its sides raked over, reusing the timeline panel’s floor images so the two
agree. The rake is **2:1** — one across per two down. All the horizontal room a
floor needs comes from its shear, so a shallower rake buys height for nothing,
and height was what the floors lacked.

The squash is filtered, not sampled: each pixel averages the pixels it stands
for, because a tile grid picked row by row is a shimmer, not a floor plan.
**The whole tower always fits — nothing scrolls.** Floors are spaced to fill the
panel and centred in it, so a tall tower’s overlap, each showing a band of
itself; that is what the 2 px outline is for. A short tower spreads out instead,
to a limit of two pixels of air.

Every floor is drawn identically. The current one is marked by being drawn last,
over the others, with a lavender outline, and by being the only one labelled —
not by being enlarged. Nothing in the stack moves as you scrub, which matters
more than emphasis: the floors are to become hoverable, and a target that moves
as you reach for it is the wrong kind of interface.

**Player status.** A column right of the stack. Numbers are right-aligned into
a centre gutter with labels beside it, so magnitudes line up and read downward.
Some rows carry a sprite rather than a word, as the game labels them; the held
item is the one row whose *value* is a sprite, in the gutter, `held` naming it.

Rows: power, light keys, dark keys, pickaxes, gold, gems spent, held item.
Power is shown in full with the game's dot separators — `1.284.900`, never
`1.28M`. Gems are an amount **spent**, not a fraction of a total: spent is what
a route is planned against, since the total moves as gems come in elsewhere.

Three rows are conditional and absent otherwise, as in the game: dark keys go
where the key system runs negative, gold only on towers that use money, and the
held-item row only when something is held.

**Settings.** Below everything: a performance test, and floor captions.

## 5. Presentation

Everything is drawn as the game draws it — the same tiles, the same bitmap
fonts, whole-number scaling, no smoothing, so pixels stay square at any window
size. The game's pixel-perfect and filtered-upscale settings are mirrored here.

The game is monochrome apart from the player, and so are we: the player carries
the game's own cyan tint, which is why it can be found among fifteen white
sprites. Every other colour is ours, and belongs to things the game does not
draw: the route trail now, the analysis overlays later.

Zoom is the app's own, on `+` / `-` with `0` for automatic — not the browser's,
which scales the canvas by a fraction when the whole point is whole numbers.

## 6. Open questions

Answered ones move out — to `DECISIONS.md` if the reasoning matters, into the
text above if not.

- **The trail is anti-aliased and the stack filtered**, where the game smooths
  nothing — though both are things the game never draws.
- **How big the stack should be**, and whether overlapped floors stay legible
  on a 32- or 75-floor tower.
- **Freezing past and future floors** so only the current one changes as you
  scrub: the past at its final state, the future at its initial one. For
  readability, and for scanning the timeline at a glance.
- **Whether a scroll unit should ever be narrower than the screen.** The
  working set is settled — it is what fits — but a unit that changes with the
  window is a view concept with no persistence, and a tall tower may want the
  boundaries somewhere more meaningful than "wherever the strip ran out". D34.
