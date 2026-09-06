// SPEC-007 §1 + SPEC-008 §6 + docs/UI.md §1, §8 — the shell: empty state, file
// load, record pick, the editing commands, and saving.
//
// React owns the chrome and nothing inside the canvas. Once a record is
// chosen, Scrubber takes over; React re-renders only when the *document*
// changes, never on a scrub.

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { routeFromRecord } from "../sav/route";
import { LuaArray, parseTop } from "../sav/buffer";
import { emitPayload, emitSaveFile, parseSaveFile, type SaveRecord } from "../sav/savefile";
import { importRoute, UNLIMITED_GEMS, type OrdFile, type Route } from "../sim/route/document";
import { ordFile, parse as parseOrd, payloadHash } from "../sim/route/ordfile";
import type { TowerJSON } from "../sim/types";
import { WorkingStore, type Session, type ViewState } from "../store/working";
import { knownTowerIds, loadSheet, loadTower, manifest, towerIdFromFilename } from "./assets";
import { blankSummaries, fillSummaries, type Summary } from "./records";
import { RouteSession } from "./session";
import { Scrubber, type ScrubberSettings } from "./scrubber";

const NOTICE =
  "Unofficial. Orderlyorderer is a fan-made planning tool for Towers of Scale. " +
  "It is not made by, endorsed by or affiliated with the game's developer.";
const SAVE_HINT = "%APPDATA%\\LOVE\\towers_of_scale\\";
const HYGIENE =
  "Your routes live in .ord files that you save and keep. The working store in this browser is " +
  "crash recovery, not a backup: clearing site data or a private window discards it.";

const DEFAULT_VIEW: ViewState = { route: 0, stop: 0, captions: true, zoom: "auto" };

/** A computed column: still coming, absent, or a number. */
function column(s: Summary, v: number | null, format: (n: number) => string = String): string {
  if (s.orbs) return "";
  if (!s.computed) return "…";
  return v === null ? "—" : format(v);
}

function download(name: string, bytes: string | Uint8Array, type: string): void {
  // A fresh ArrayBuffer, because a Uint8Array over a SharedArrayBuffer is not a
  // BlobPart and the codec makes no promise about which it hands back.
  const part = typeof bytes === "string" ? bytes : new Uint8Array(bytes).buffer.slice(0);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** `[D]` Export never overwrites, so every file carries the moment it was written. */
function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
}

export default function App(): React.ReactElement {
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  const [tower, setTower] = useState<TowerJSON | null>(null);
  const [records, setRecords] = useState<Summary[] | null>(null);
  const [session, setSession] = useState<RouteSession | null>(null);
  const [pendingBytes, setPendingBytes] = useState<Uint8Array | null>(null);
  const [pendingOrd, setPendingOrd] = useState<OrdFile | null>(null);
  const [restorable, setRestorable] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped by the scrubber after every document-tier change; nothing else.
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<ScrubberSettings>({
    pixelPerfect: true,
    linearFilter: false,
    perf: false,
    path: true,
    zoom: "auto",
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubberRef = useRef<Scrubber | null>(null);
  const storeRef = useRef<WorkingStore | null>(null);

  useEffect(() => {
    loadSheet().then(setSheet).catch((e: Error) => setError(String(e)));
  }, []);

  // `[D]` The working store is opened once and asked what it holds. A stored
  // session whose `loadCompleted` is false means a *restore* crashed part-way,
  // so the offer is to start clean rather than to restore into the same crash.
  //
  // `[F]` The flag is cleared when a restore is **accepted**, not when the app
  // starts. Clearing it at startup made every launch that opened nothing look
  // like a crash to the launch after it: open the app, reload, and the second
  // reload reported a failure that had never happened.
  useEffect(() => {
    let live = true;
    WorkingStore.open()
      .then(async (store) => {
        storeRef.current = store;
        const stored = await store.read();
        if (!live || stored === null) return;
        if (!stored.loadCompleted) {
          setNotice("A working copy could not be loaded last time, so it has been discarded. Open a file to start clean.");
          await store.clear();
          return;
        }
        setRestorable(stored);
      })
      .catch(() => {
        // A browser with IndexedDB disabled still runs; it just does not resume.
        setNotice("This browser is not storing a working copy, so nothing will be recovered after a crash.");
      });
    return () => {
      live = false;
    };
  }, []);

  const start = useCallback(
    (document: OrdFile, t: TowerJSON, view: ViewState, inserted: string[] = [], savedHash: string | null = null) => {
      const s = new RouteSession(document, view.route, t, view);
      s.savedHash = savedHash;
      s.restoreInserted(inserted);
      setTower(t);
      // `[I]` The record list is NOT cleared. Closing a route should go back to
      // the list it was chosen from, not all the way out to the file picker:
      // picking another record from the same save is the common next thing.
      setPendingOrd(null);
      setRestorable(null);
      // Whatever the shell was saying was about getting here, and we are here.
      setNotice(null);
      setError(null);
      setSession(s);
    },
    [],
  );

  const openFile = useCallback(
    async (file: File) => {
      setError(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (file.name.endsWith(".ord")) {
        try {
          const doc = parseOrd(new TextDecoder().decode(bytes));
          if (doc.routes.length === 1) await openOrdRoute(doc, 0);
          else setPendingOrd(doc);
        } catch (e) {
          setError(String(e));
        }
        return;
      }
      const id = towerIdFromFilename(file.name);
      if (id === null) {
        // If the filename does not name a tower we know, ask rather than guess.
        setPendingBytes(bytes);
        return;
      }
      await openWith(id, bytes);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openOrdRoute = useCallback(
    async (doc: OrdFile, index: number) => {
      const route = doc.routes[index];
      if (!route) return;
      try {
        const t = await loadTower(route.tower);
        start(doc, t, { ...DEFAULT_VIEW, route: index }, [], null);
      } catch (e) {
        setError(String(e));
      }
    },
    [start],
  );

  // Which file the list belongs to. Opening another one abandons the fill that
  // is still running against the old one rather than letting it write over it.
  const openedRef = useRef(0);

  const openWith = useCallback(async (id: string, bytes: Uint8Array) => {
    const mine = ++openedRef.current;
    try {
      const t = await loadTower(id);
      const rows = blankSummaries(parseSaveFile(bytes).records);
      setTower(t);
      setRecords(rows);
      setPendingBytes(null);
      await fillSummaries(
        t,
        rows,
        (i, r) => setRecords((prev) => prev && prev.map((row, j) => (j === i ? r : row))),
        () => openedRef.current !== mine,
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /** `stop` is for the visual harness (SPEC-009 §3); a hand always starts at 0. */
  const chooseRecord = useCallback(
    (record: SaveRecord, t: TowerJSON, stop = 0) => {
      const route = importRoute({
        name: record.name,
        tower: t.tower_id,
        gemsOwned: UNLIMITED_GEMS,
        waypoints: routeFromRecord(record),
        source: { file: `${t.tower_id}.sav`, record: record.name, hash: payloadHash(emitPayload(record.entries)) },
      });
      start(ordFile([route]), t, { ...DEFAULT_VIEW, stop });
    },
    [start],
  );

  // SPEC-009 §3 — the visual harness. The dynamic import inside the DEV guard
  // is what keeps every line of it out of a production build: Vite replaces
  // the condition with `false` and Rollup drops the import with the branch.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import("./dev")
      .then((dev) => {
        dev.expose(scrubberRef);
        return dev.openFromUrl(chooseRecord);
      })
      .catch((e: Error) => setError(String(e)));
  }, [chooseRecord]);

  // Mount the scrubber once a session exists, and never re-render it after.
  useEffect(() => {
    if (!session || !sheet || !canvasRef.current) return;
    const s = new Scrubber(canvasRef.current, manifest, sheet, settings, setSettings, () => setRevision((r) => r + 1));
    scrubberRef.current = s;
    s.load(session);
    void storeRef.current?.markLoaded();
    return () => {
      s.destroy();
      scrubberRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not `settings`: see update() below.
  }, [session, sheet]);

  useEffect(() => {
    scrubberRef.current?.update(settings);
  }, [settings]);

  // `[D]` The working store is written on every edit (DESIGN §2.2), which is
  // exactly what `revision` counts. Nothing derived goes in: the simulation is
  // a pure function of the tower and the flattened route.
  useEffect(() => {
    if (!session) return;
    void storeRef.current?.write({
      document: session.document,
      view: session.view,
      inserted: session.insertedPaths(),
      savedHash: session.savedHash,
      loadCompleted: true,
      savedAt: Date.now(),
    });
  }, [session, revision]);

  const dirty = session !== null && session.dirty;

  // `[I]` The unsaved-changes marker, large and unmissable, in the tab title as
  // well as in the app.
  useEffect(() => {
    document.title = dirty ? "* Orderlyorderer — unsaved" : "Orderlyorderer";
  }, [dirty, revision]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) void openFile(f);
    },
    [openFile],
  );

  const shell = useMemo(
    () => ({ onDragOver: (e: React.DragEvent) => e.preventDefault(), onDrop }),
    [onDrop],
  );

  const saveOrd = useCallback(() => {
    if (!session) return;
    download(`${session.route.tower}-${session.route.name}.ord`.replace(/[/\\:*?"<>|]/g, "_"), session.toOrd(), "application/json");
    session.markSaved();
    setRevision((r) => r + 1);
  }, [session]);

  const exportSav = useCallback(() => {
    if (!session) return;
    try {
      const payload = session.toSaveRecord();
      // Shape B, `{ time, data }` -- the shape the game writes today.
      // SAVE_FORMAT §2's bare blob is an older form it has never migrated, and
      // an export is not the place to hand it something it stopped producing.
      const bytes = emitSaveFile({
        records: [{
          name: session.route.name,
          time: new Date().toISOString().slice(0, 16).replace("T", " "),
          keyOrder: ["time", "data"],
          entries: decodeEntries(payload),
        }],
      });
      download(`${session.route.tower}.orderlyorderer.${stamp()}.sav`, bytes, "application/octet-stream");
      setNotice("Exported. It is a new file, never an overwrite: move it into place yourself.");
    } catch (e) {
      setError(String(e));
    }
  }, [session]);

  if (session && sheet) {
    const s = scrubberRef.current;
    return (
      <div className="app" {...shell}>
        <canvas ref={canvasRef} className="stage" />
        <div className="tools">
          <button onClick={() => setSession(null)}>← routes</button>
          <input
            className="name"
            value={session.route.name}
            onChange={(e) => {
              session.rename(e.target.value);
              setRevision((r) => r + 1);
            }}
            title="The route's name, as it will be saved"
            spellCheck={false}
          />
          <button onClick={() => s?.undo()} disabled={!session.canUndo} title="Take back the last insertion (Z)">undo</button>
          <button onClick={() => s?.redo()} disabled={!session.canRedo} title="Put it back (Y)">redo</button>
          <span className="sep" />
          <button onClick={saveOrd} className={dirty ? "urgent" : ""}>{dirty ? "save .ord *" : "save .ord"}</button>
          <button onClick={exportSav} disabled={session.evaluation.mainline.error !== undefined} title="Write a new .sav; never an overwrite">
            export .sav
          </button>
          <button onClick={() => s?.saveCapture()} title="Save this frame as a PNG (S)">screenshot</button>
          {dirty && <span className="unsaved">UNSAVED CHANGES</span>}
        </div>
        {notice && <p className="toast" onClick={() => setNotice(null)}>{notice}</p>}
        {error && <p className="toast error" onClick={() => setError(null)}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="app shell" {...shell}>
      <div className="pane">
        <h1>Orderlyorderer</h1>
        {error && <p className="error">{error}</p>}
        {notice && <p className="hint">{notice}</p>}

        {restorable !== null && (
          <div className="ask">
            <p>
              A working copy from {new Date(restorable.savedAt).toLocaleString("en-GB")} was recovered.
              <strong> This is crash recovery, not a backup.</strong> Save it to an <code>.ord</code> file.
            </p>
            <div className="towers">
              <button
                onClick={() => {
                  const route = restorable.document.routes[restorable.view.route];
                  if (!route) return;
                  // Only now is a load in flight, so only now is the flag cleared.
                  void storeRef.current
                    ?.markLoading()
                    .then(() => loadTower(route.tower))
                    .then((t) => start(restorable.document, t, restorable.view, restorable.inserted, restorable.savedHash))
                    .catch((e: Error) => setError(String(e)));
                }}
              >
                restore it
              </button>
              <button
                onClick={() => {
                  void storeRef.current?.clear();
                  setRestorable(null);
                }}
              >
                discard
              </button>
            </div>
          </div>
        )}

        {records === null && pendingBytes === null && pendingOrd === null && (
          <>
            <label className="drop">
              <strong>Open a save file or a route</strong>
              <span>or drop one anywhere on this window</span>
              <input
                type="file"
                accept=".sav,.ord"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void openFile(f);
                }}
              />
            </label>
            <p className="hint">
              Saves live in <code>{SAVE_HINT}</code>
            </p>
            <p className="hint">{HYGIENE}</p>
          </>
        )}

        {pendingBytes !== null && (
          <div className="ask">
            <p>That filename does not name a tower. Which one is it?</p>
            <div className="towers">
              {knownTowerIds().map((id) => (
                <button key={id} onClick={() => void openWith(id, pendingBytes)}>
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}

        {pendingOrd !== null && (
          <div className="ask">
            <p>That file holds several routes. Which one?</p>
            <div className="towers">
              {pendingOrd.routes.map((r: Route, i: number) => (
                <button key={`${r.tower}/${r.name}`} onClick={() => void openOrdRoute(pendingOrd, i)}>
                  {r.tower} · {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* `[I]` The record list needs a way back out, the way the route view
            has one back to the list: picking the wrong file otherwise left the
            only exit as a page reload. */}
        {records !== null && (
          <p>
            <button
              className="link"
              onClick={() => {
                setRecords(null);
                setError(null);
              }}
            >
              ← file
            </button>
          </p>
        )}

        {records !== null && tower !== null && (
          <table className="records">
            <thead>
              <tr>
                <th>Record</th>
                <th>Saved</th>
                <th>Power</th>
                <th>Floor</th>
                <th>Stops</th>
              </tr>
            </thead>
            <tbody>
              {records.map((s) => (
                <tr key={s.record.name} className={s.orbs ? "disabled" : ""}>
                  <td>
                    {s.orbs ? (
                      <span title="Orb moves are not simulated in this slice">{s.record.name}</span>
                    ) : (
                      <button onClick={() => chooseRecord(s.record, tower)}>{s.record.name}</button>
                    )}
                  </td>
                  <td>{s.record.time ?? "—"}</td>
                  <td>{s.orbs ? "uses orbs" : column(s, s.power, (n) => n.toLocaleString("en-GB"))}</td>
                  <td>{column(s, s.highest)}</td>
                  <td>{column(s, s.stops)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="notice">{NOTICE}</p>
      </div>
    </div>
  );
}

/**
 * The exporter hands back a payload; the container writer wants entries.
 *
 * `[F]` Reading it back through SPEC-006's own parser rather than keeping the
 * waypoint list around is deliberate: it is the same check oracle 1 makes, run
 * on the way out of the app, so a payload the parser cannot read never reaches
 * a file.
 */
function decodeEntries(payload: Uint8Array): number[][] {
  const outer = parseTop(payload);
  if (!(outer instanceof LuaArray)) throw new Error("the emitted payload is not an array");
  return outer.map((e) => (e as LuaArray).map((n) => n as number));
}
