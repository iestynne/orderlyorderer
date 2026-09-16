// The export screen: the warning, the protocol, and the two ways out.
//
// `[D]` **Every word it says lives in `text.ts`**, so the wording can be edited
// without reading JSX. This file holds structure and nothing else — if a string
// literal appears below, it is a class name or an ARIA role. `[I]` iestyn,
// 2026-09-14: the export path is the dangerous one, so it is the one whose
// language has to be easy to go over.
//
// `[D]` A screen rather than a toast. This app cannot reach the game's save
// folder (`store/savefolder.ts`), so what it writes is only useful once the
// player copies it across — which makes the instructions the feature, not a
// caveat attached to it.
//
// `[D]` Three stages. **Prepare** comes first because the folder it asks for has
// to exist before the file picker opens — a player meeting the OS dialog with no
// `tos_backups` has nothing to select. **Choose** lists what was found.
// **Done** shows the protocol again, because that is the moment it is needed:
// the files are written and the player is about to go and use them. `[I]`
// iestyn, 2026-09-10, on both.
//
// `[D]` The warning does not animate for anyone who has asked motion to stop
// (`prefers-reduced-motion`), and never flashes: a two-second breath is loud
// enough to read as a warning without being a photosensitivity hazard.

import type React from "react";
import { useState } from "react";
import type { Backup, Exported } from "../store/savefolder";
import { md } from "./md";
import { EG, EXPORT, type Step } from "./text";

export type ExportChoice = "pick" | "download";

function Steps({ list }: { list: readonly Step[] }): React.ReactElement {
  return (
    <ol className="protocol">
      {list.map(([step, why]) => (
        <li key={step}>
          <strong>{md(step)}</strong>
          {why !== undefined && <span>{md(why)}</span>}
        </li>
      ))}
    </ol>
  );
}

function Restore({ folder }: { folder: string }): React.ReactElement {
  return (
    <details>
      <summary>{EXPORT.restoreSummary}</summary>
      <ul>
        {EXPORT.restore(folder).map((line) => (
          <li key={line}>{md(line)}</li>
        ))}
      </ul>
    </details>
  );
}

interface Props {
  towerId: string;
  recordName: string;
  gems: number;
  canPick: boolean;
  busy: boolean;
  /** Non-null once a container has been picked: what was found inside it. */
  backups: readonly Backup[] | null;
  /** The picked folder held saves itself, so it is a snapshot, not the container. */
  isSnapshot: boolean;
  /** Set once the write has happened: the protocol is shown against this. */
  done: Exported | null;
  onChoose: (c: ExportChoice) => void;
  onExport: (b: Backup) => void;
  onCancel: () => void;
}

/** Why this backup cannot be built from, or `null` if it can. */
function refusal(b: Backup, towerId: string): string | null {
  if (b.towers.length === 0) return EXPORT.whyEmpty;
  if (!b.stamped) return EXPORT.whyUndated;
  if (!b.towers.includes(towerId)) return EXPORT.whyNoTower(towerId);
  return null;
}

export function ExportDialog(props: Props): React.ReactElement {
  const [understood, setUnderstood] = useState(false);

  const body = (): React.ReactElement => {
    // Stage 3 — written. The protocol, now that it is about to be used.
    if (props.done !== null) {
      const out = props.done;
      return (
        <>
          <p className="lede">
            {md(EXPORT.wrote(out.name, out.accumulated, `${out.folder}/${props.towerId}.sav`, out.records, out.towers.join(", ")))}
          </p>
          <h2>{EXPORT.deployHeading}</h2>
          <Steps list={EXPORT.deploy(out.folder)} />
          <Restore folder={out.from} />
          <div className="towers">
            <button className="urgent" onClick={props.onCancel}>{EXPORT.done}</button>
          </div>
        </>
      );
    }

    // Stage 2 — a container has been picked.
    if (props.backups !== null) {
      return (
        <>
          <p className="lede">{md(EXPORT.which)}</p>
          {props.isSnapshot && <p className="warn">{md(EXPORT.pickedSnapshot)}</p>}
          {props.backups.length === 0 && !props.isSnapshot && <p className="hint">{md(EXPORT.nothingToBuildFrom)}</p>}
          <ul className="backups">
            {props.backups.map((b) => {
              const why = refusal(b, props.towerId);
              return (
                <li key={b.name}>
                  <button disabled={why !== null || props.busy} onClick={() => props.onExport(b)}>
                    {b.name}
                  </button>
                  <span>
                    {EXPORT.saves(b.towers.length)}
                    {why === null ? "" : <> — {md(why)}</>}
                    {b.newest && <strong className="latest">{EXPORT.latest}</strong>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="hint">{md(EXPORT.gathers)}</p>
          <div className="towers">
            <button disabled={props.busy} onClick={props.onCancel}>{EXPORT.cancel}</button>
          </div>
        </>
      );
    }

    // Stage 1 — prepare.
    return (
      <>
        <p className="lede">
          {md(EXPORT.lede(props.recordName, props.towerId))}
          <strong>{md(EXPORT.ledeEmphasis)}</strong>
        </p>

        {props.gems > 0 && <p className="hint">{md(EXPORT.gems(props.gems))}</p>}

        <h2>{EXPORT.prepareHeading}</h2>
        <Steps list={EXPORT.prepare} />
        <p className="hint">{md(EXPORT.thenPick)}</p>

        {/* Stage 1 has no real folder yet, so the worked example stands in. */}
        <Restore folder={EG} />

        <label className="understood">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          {md(EXPORT.understood)}
        </label>

        <div className="towers">
          <button
            className="urgent"
            disabled={!understood || !props.canPick || props.busy}
            onClick={() => props.onChoose("pick")}
            title={props.canPick ? EXPORT.pickTitle : EXPORT.noPickerTitle}
          >
            {props.busy ? EXPORT.picking : EXPORT.pick}
          </button>
          <button disabled={props.busy} onClick={() => props.onChoose("download")} title={EXPORT.downloadTitle}>
            {EXPORT.download}
          </button>
          <button disabled={props.busy} onClick={props.onCancel}>{EXPORT.cancel}</button>
        </div>

        {!props.canPick && <p className="hint">{md(EXPORT.noPicker)}</p>}
      </>
    );
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={EXPORT.dialogLabel}>
      <div className="export">
        <p className="caveat" aria-label="Caveat emptor">{EXPORT.caveat}</p>
        {body()}
      </div>
    </div>
  );
}
