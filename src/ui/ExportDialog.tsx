// The export screen: the warning, the protocol, and the two ways out.
//
// `[D]` A screen rather than a toast, because this is the one action in the app
// that writes to a file the player cannot regenerate. `[I]` iestyn: the protocol
// is the one he has been following by hand and it has worked; putting it in
// front of the button is what stops it being folklore.
//
// `[D]` The warning does not animate for anyone who has asked motion to stop
// (`prefers-reduced-motion`), and never flashes: a two-second breath is loud
// enough to read as a warning without being a photosensitivity hazard.

import type React from "react";
import { useState } from "react";

export type ExportChoice = "inject" | "download";

/** `[I]` iestyn's, 2026-09-09, and tested by repetition rather than designed. */
const PROTOCOL: readonly (readonly [string, string])[] = [
  ["Launch the game", "Let Steam Cloud finish syncing, and check your saves all look right in-game."],
  ["Go back to the main menu", "Do not stay inside the tower you are about to inject into."],
  ["Copy your savestates folder somewhere else", "A folder with today's date in the name. This is the backup that matters; ours is a second one."],
  ["Inject, below", "We copy the target file aside first, write, then read it back and check nothing else moved."],
  ["Load that tower in the game", "Confirm every route you had is still there, plus the new one, and that the new one plays."],
  ["Exit the game", "Then check Steam Cloud uploads cleanly."],
];

const IF_WRONG: readonly string[] = [
  "Exit to the main menu.",
  "Send iestyn the modified .sav so the failure can be read.",
  "Copy your backup back over it — copy, not move. Backups are tiny; keep every one.",
  "If the game crashed or you quit at the wrong moment: relaunch, restore the backup, then exit cleanly so Steam Cloud takes the restored copy.",
];

interface Props {
  towerId: string;
  recordName: string;
  gems: number;
  canInject: boolean;
  busy: boolean;
  onChoose: (c: ExportChoice) => void;
  onCancel: () => void;
}

export function ExportDialog(props: Props): React.ReactElement {
  const [understood, setUnderstood] = useState(false);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export to a save file">
      <div className="export">
        <p className="caveat" aria-label="Caveat emptor">CAVEAT EMPTOR</p>
        <p className="lede">
          This writes into <code>{props.towerId}.sav</code> — a file the game wrote and you cannot regenerate.
          It will gain one record — <code>{props.recordName}</code>, or the next free name if that one is
          taken — and nothing else will change.
          <strong> Unofficial tool. Your saves are your responsibility.</strong>
        </p>

        {props.gems > 0 && (
          <p className="hint">
            This route spends {props.gems} gems. With fewer, the game refuses to load it — that is the gem
            gate, not a fault in the export.
          </p>
        )}

        <ol className="protocol">
          {PROTOCOL.map(([step, why]) => (
            <li key={step}>
              <strong>{step}</strong>
              <span>{why}</span>
            </li>
          ))}
        </ol>

        <details>
          <summary>If it goes wrong, or you change your mind</summary>
          <ul>{IF_WRONG.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>

        <label className="understood">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          I have my own backup of the savestates folder, and the game is at the main menu.
        </label>

        <div className="towers">
          <button
            className="urgent"
            disabled={!understood || !props.canInject || props.busy}
            onClick={() => props.onChoose("inject")}
            title={props.canInject ? "Pick the savestates folder and write into it" : "This browser has no folder picker; download instead"}
          >
            {props.busy ? "writing…" : "inject into my save file"}
          </button>
          <button disabled={props.busy} onClick={() => props.onChoose("download")} title="A new one-record .sav in Downloads; move it yourself">
            download a copy instead
          </button>
          <button disabled={props.busy} onClick={props.onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}
