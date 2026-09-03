# UI.md

**What the app currently does**, in natural language. Current state only.

Read with `SPEC-007` and `SPEC-008`, which hold the numbers: constants and
interfaces there, observable behaviour here. Rules and the 150-line budget: D31.

---

## 1. Shell and loading

On first run the app is only the way in: a large **Open a save file or a route**
target that also takes a file dropped anywhere on the window. A `.sav` is
imported from; an `.ord` is reopened. The empty state names where saves live,
and carries the unofficial notice and a line saying routes live in `.ord` files
the player keeps while the browser's working copy is crash recovery, not a
backup. A working copy from a previous session is offered back with that warning again;
one that crashed *during* load is discarded instead, and the app says so.

Opening a `.sav` lists its records at once: name, timestamp where there is one,
and three figures simulated behind the list, `…` until each lands — final power,
highest floor, waypoint stops. Player-named records sort above the `AUTOSAVE_*`
ones, those names being the player's own index. A record using orbs is listed
but not openable, and says why. The tower comes from the filename; if that names
no tower we know, the app asks. An `.ord` names its own tower, and is asked
which route only when it holds more than one. Choosing one replaces the empty
state with the two panels, over a toolbar: close, save `.ord`, export `.sav`, a
**screenshot** button writing the exact 1× frame to a PNG, and the keys.

## 2. Timeline panel

The left panel is a horizontally scrolling strip of floors in the order the
route visits them, each tile captioned with its name and which visit it is. A
floor earns a tile only where the player **acts** on it; floors merely walked
through get none, and the trail crosses the gap in one dashed segment so it
reads as travel. The route is cut into **scroll units**: runs whose floors all
fit at once. Inside a unit each floor has one tile and the strip does not move;
it shifts only when scrubbing leaves the unit, so a three-floor tower never
scrolls. Scroll units are a **view** device — recomputed on resize, never saved,
and not the route segments of §6. D34.

Tiles lie in two rows, each offset half a tile-width from the last, in a
bricklayer pattern; every one has a border and a gap. At least three are
visible, a wider window showing more. When the strip does move it glides, easing
over about half a second and landing on whole pixels. The captions can be
switched off, which gives their height back to the floors.

## 3. The route trail

A line runs through the route's waypoints over the floors, connecting them
directly rather than following the walked path. It crosses between tiles, so
stairs read as one continuous line; those crossings are dashed as travel. Both
halves are lavender, separated only by hue: the past shifted towards blue, the
future towards red. Both carry a black outline, and both fade to nothing two
stops either side of the scrub position — a narrow reminder, not a whole-route
overlay. **Once the route breaks**, that pair is replaced by green as far as it
gets and red from the action that breaks it, and not before. The future draws
before the past and the segment at the scrub position draws last; the player is
drawn at the current waypoint in the state *after* that action, with its power
beneath it.

## 4. Control panel

The right panel holds a fixed shape at any window size while the left panel
takes the rest. Left to right: the scrub slider, the **action list** of §6, the
tower stack, and the player status — the last two overlapping, because only
Power is wide.

**Scrub slider.** Vertical, running **upward**: the first action is at the
bottom, as floor 1 is in the stack beside it. It stops once per action —
disabled ones included, which keep their number and their place — plus once at
the final position. Ticks mark floor changes; a counter reads which action you
are on. The handle is an hourglass on its side, crossing the track at its waist:
wide enough to grab, pinched so it never hides its tick. The track carries §3's
verdict, green then red, and nothing while the route runs clean; where it breaks
it carries the **no-entry sign**, which clicks through to that exact action.

**Tower stack.** The whole tower as a vertical stack of floors, each squashed
and raked over at **2:1**, reusing the timeline's floor images so the two agree.
The squash is filtered, not sampled: each pixel averages the pixels it stands
for. **The whole tower always fits — nothing scrolls.** Floors are spaced to
fill the panel, so a tall tower's overlap behind a 2 px outline, each showing a
band of itself; a short tower spreads to a limit of two pixels of air. Every
floor is drawn identically: the current one is marked by being drawn last, with
a lavender outline, and by being the only one labelled. Nothing moves as you
scrub.

**Player status.** Along the top of the panel and down its right edge. **Power
leads, on its own line above the stack**, in full with the game's dot separators
— `1.284.900`, never `1.28M` — being the only figure that needs the width. The
rest run down a narrow column the stack is free to reach under: light keys, dark
keys, pickaxes, gold, gems, held item, each a sprite and a number of at most
four digits. Gems are an amount **spent**, which the row says on hover rather
than in a word. Dark keys, gold and the held item are absent where the game
omits them too.

**Settings.** Behind a cog at the top-right of the left panel: a performance
test, and floor captions.

## 5. Presentation

Everything is drawn as the game draws it — the same tiles, the same bitmap
fonts, whole-number scaling, no smoothing, so pixels stay square at any window
size. The game's pixel-perfect and filtered-upscale settings are mirrored here,
but zoom is the app's own, on `+` / `-` with `0` for automatic. The game is
monochrome apart from the player, and so are we: the player carries the game's
own cyan tint. Every other colour is ours, and belongs to what the game does not
draw — the trail and the editing marks now, the overlays later.

## 6. Editing

A route acts on the same cell more than once — walking a spike tile twice, or
back through a one-way — so a badge on the floor cannot say *which* of those
actions it means. The **action list**, right of the slider, is what makes an
edit unambiguous: a window of the route centred on the current action, which
wears a thin lavender outline.

A row is what the action **did**, not where: its number, an icon for the thing
acted on, and its toggles on the right. An attack shows the enemy, the held item
where that changed the outcome, and the gold earned; a gate shows the gate, and
the Master Key where that opened it; a dig shows the wall and the pickaxe spent;
a pickup shows the item; a spike or one-way shows the tile. Hovering a row
highlights it on the timeline.

**Every edit happens at the current action**, which is why there are no modes.

- A row's checkbox switches its action off. A disabled row greys out and takes
  the minus badge; it keeps its number and its place on the slider, and scrubs
  through unchanged, because it no longer does anything.
- **Inserting is a click on a floor cell**, and it lands directly after the
  current action. Hovering that cell first shows both halves of what would
  happen: the `+` badge on the cell, and a greyed pending row in the list right
  after the current one, gapped above and below and carrying `+` on its left.
  Clicking commits it, and the row keeps a `+` on the right beside its checkbox
  for as long as it is unsaved. A cell that implies no action shows nothing at
  all; one the rules would refuse shows the **no-entry sign**.
- `Z` and `Y` undo and redo insertions, as the game's own undo and redo do.
  They reach back over the current run of them and no further: insert four
  here, scrub away, insert four there, and `Z` takes back four.

The current action is drawn twice, so the list and the timeline agree: the
target tile is outlined on the floor, and the row is repeated a tile and a half
below it in a two-pixel lavender-on-black frame. That copy is a display, not a
control. Where the route breaks, the failing action carries the no-entry sign
at its left; where the current action is disabled, both drawings are ghosted.

Anything that changes the document sets the **unsaved-changes marker**, in the
toolbar and the tab title; scrubbing and the option toggles do neither. **Save
`.ord`** clears it. **Export `.sav`** writes a fresh, uniquely named file, never
an overwrite, and refuses a route that fails. Segments have their own
affordances — split, merge, alternatives, skippable — and they are **off** while
adding and removing actions is the thing being learned.

## 7. Open questions

Answered ones move out — to `DECISIONS.md` if the reasoning matters, else above.

- **The trail is anti-aliased and the stack filtered**, where the game is not.
- **How big the stack should be**, and whether overlapped floors stay legible on
  a 32- or 75-floor tower.
- **Freezing past and future floors** as you scrub: the past at its final state,
  the future at its initial one.
- **Whether a scroll unit should ever be narrower than the screen.**
- **How a disabled action should be ghosted**, in the list and on the floor.
- **How wide the action list wants to be**, and how many rows it shows.
