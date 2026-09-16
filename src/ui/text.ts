// Every word the export path says to the player, in one file.
//
// `[D]` **Named keys, not numbered chunks.** Numbering exists so a translator
// can swap an asset file positionally; with one language it buys nothing and
// costs the thing that matters here — a number is a silent indirection, and
// pointing at the wrong one gives wrong text with no error. A named key is
// type-checked, greppable, and reads as itself in a diff. `src/ui/render/
// marks.ts` already works this way. `[I]` iestyn, 2026-09-14.
//
// `[D]` Interpolated lines are **functions**, not templates with placeholders,
// so a changed wording cannot quietly drop the folder name it was carrying.
//
// `[D]` Scope is the export path only. Button labels like `undo` and `cancel`
// stay where they are: tabling a one-word label costs more than it gives.
//
// `[D]` No platform names anywhere in here. The game ships for one, but nothing
// in this app depends on which file manager the player has. `[I]` iestyn.

import { exportDirFor } from "../store/savefolder";

/**
 * `[D]` One worked example runs through every stage, so "that folder" is never
 * ambiguous — and the export folder's name is *derived* from it, so the pair
 * shown to the player is the pair the code would really produce.
 */
export const EG = "savestates-2026-09-10";
export const EG_OUT = exportDirFor(EG);

/**
 * A numbered instruction: what to do, and optionally why.
 *
 * `[D]` The reason is optional because some steps do not have one worth
 * writing, and inventing filler to satisfy a type is how instructions get
 * padded. Both halves take `md()` marks.
 */
export type Step = readonly [string, string?];

export const EXPORT = {
  caveat: "CAVEAT EMPTOR",
  dialogLabel: "Export to a save file",

  // --- stage 1, prepare ---------------------------------------------------
  prepareHeading: "Before you click",
  lede: (record: string, tower: string): string =>
    `This adds one route, ${record} — or the next free name if that name is taken — to a copy of ` +
    `${tower}.sav. It never touches your real save file, your browser is not allowed near that folder; ` +
    "you must copy the new .sav file into your game savestates folder yourself.",
  ledeEmphasis: " Unofficial tool. Your saves are your responsibility.",
  gems: (n: number): string =>
    `This route spends ${n} gems. If you have fewer gems, the game will fail to load the route. ` +
    "That is the expected, not a fault in the export.",
  prepare: [
    ["Make a folder called tos_backups", "Anywhere you like. It is yours, and this app only ever writes inside it."],
    ["Copy your whole savestates folder into it", "Copy, never move — the original stays where the game expects it."],
    ["Give the copy today's date", `${EG}, say, so you can identify each backup later.`],
  ] as readonly Step[],
  thenPick: `Then pick the folder that contains your dated copies — pick tos_backups, not one of the copies. The exported .sav will be written to a new folder, ${EG_OUT}, and you will copy it into the game's savestates folder afterwards.`,
  understood: "I have made tos_backups, copied my savestates folder into it, and dated the copy.",
  pick: "pick my tos_backups folder",
  picking: "reading…",
  pickTitle: "Pick your tos_backups folder",
  download: "download a copy instead",
  downloadTitle: "A new one-route .sav in your downloads",
  cancel: "cancel",
  noPickerTitle: "This browser has no folder picker; download instead",
  noPicker:
    "This browser has no folder picker — Chrome and Edge have one, Firefox and Safari do not. The download " +
    "works everywhere, but it is one route on its own: copying it to the game's savestates folder would replace your other routes " +
    "rather than join them, so it is the riskier of the two. You can use it to unlock more gems, but then must restore your most recent backups immediately after.",

  // --- stage 2, choose ----------------------------------------------------
  which: "Which backup should the export be built from?",
  pickedSnapshot: `That folder holds .sav files, so it looks like a savestates copy rather than the root backups folder that all your backups live in. Pick tos_backups itself — the one containing ${EG}, not ${EG}.`,
  nothingToBuildFrom: `Nothing in there to build from. Copy your savestates folder into it first, and give the copy today's date — ${EG}.`,
  saves: (n: number): string => `${n} saves`,
  latest: " ← latest save backup",
  whyEmpty: "no .sav files in it",
  whyUndated: "no date in the name, so nothing will identify it later",
  whyNoTower: (tower: string): string => `no ${tower}.sav in it`,
  gathers: `The export lands in a folder named for whichever backup you choose: **${EG}** gives **${EG_OUT}**. Export again from the same backup and the routes gather there, which is safe — but only until you run the game again (at which point your backups will be out of date).`,

  // --- stage 3, written ---------------------------------------------------
  deployHeading: "Now do this",
  wrote: (name: string, joined: boolean, file: string, records: number, towers: string): string =>
    `**${name}** ${joined ? "joined" : "was exported to"} **${file}**, which now holds ${records} routes. ` +
    `Every other route was read back from disk and is unchanged. The folder holds ${towers}.`,
  done: "done",
  /**
   * `[D]` The deploy steps take the export folder as an argument rather than
   * naming the example, because by this stage the real folder exists and the
   * player is about to go and find it.
   */
  deploy: (out: string): readonly Step[] => [
    ["Launch the game and let Steam Cloud finish syncing"],
    ["Go to the main menu and stay there", "Not inside the tower you are about to change."],
    [
      `Copy the contents of ${out} into your savestates folder`,
      "Copy the .sav files inside it — not the folder itself. Steam Cloud corrupts any folder placed in there.",
    ],
    ["Check every route you had is still present", "In the game's savestate list, for that tower."],
    ["Load your best route", "It should play exactly as before."],
    ["Load the newly exported route", "If it loads, the export worked."],
    ["Quit, and let Steam Cloud sync again", "Now the route is part of your saves."],
  ],

  // --- said outside the dialog, by App.tsx --------------------------------
  downloaded: (record: string): string =>
    `Downloaded one route, ${record}, in a .sav file of its own. It is not your save file and does not hold ` +
    "your other routes, so putting it into the game's savestates folder would replace them. Prefer the folder route if you can.",
  noFolderPicked:
    "No folder was picked. If the picker never appeared, this browser has no File System Access API — " +
    "Chrome and Edge do; Firefox and Safari do not.",

  // --- restore, shown in both stage 1 and stage 3 --------------------------
  restoreSummary: "To restore your backup, if it goes wrong or you change your mind",
  restore: (folder: string): readonly string[] => [
    "If the game crashed or quit, start it again first.",
    "Go to the main menu.",
    `Copy the contents of ${folder} over your savestates folder — copy, not move.`,
    "Quit cleanly, so the restored backup is what Steam Cloud syncs.",
    "Keep every backup. They are tiny... and the one you delete is the one you'll need ;)",
    "This app never deletes a route — delete or rename them in the game as you see fit.",
    "If the game refuses to load an exported route, send iestyn that .sav for diagnosis.",
  ],
} as const;
