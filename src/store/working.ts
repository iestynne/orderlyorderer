// SPEC-008 §6 — the working store.
//
// `[D]` **It is crash recovery, not a backup** (DESIGN §2.2). It lives in one
// browser on one machine, and clearing site data, private browsing or quota
// eviction each discard it. Restoring from it warns.
//
// `[D]` **Nothing derived is stored** — no simulation, journal, cell grids,
// floor bitmaps or atlas. All of it is a pure function of the tower and the
// flattened route, so a cache here would only be something to invalidate.
//
// This is the one module that touches a browser API, and it holds no logic
// (D7): everything below is open, read, write, delete.

import type { OrdFile } from "../sim/route/document";

const DB = "orderlyorderer";
const STORE = "working";
const KEY = "session";
const VERSION = 1;

/**
 * What the player is looking at. Restored so that reopening resumes the session.
 *
 * `[F]` There is no mode here and no selection. Every edit is made against the
 * action the slider is on (docs/UI.md §6), so the position **is** the mode; the
 * selection comes back with the segment affordances.
 */
export interface ViewState {
  /** Index into the document's routes. */
  route: number;
  stop: number;
  captions: boolean;
  zoom: number | "auto";
}

export interface Session {
  document: OrdFile;
  view: ViewState;
  /**
   * Action paths, `"epoch/segment/index"`, that are new since the last save.
   *
   * `[D]` Session state, never written to the `.ord` (DESIGN §3): it means "new
   * since the last save", has exactly two transitions -- set on insert, cleared
   * on save -- and both are ours, so it cannot drift.
   */
  inserted: string[];
  /** The document hash at the last save, or null if this document was never saved. */
  savedHash: string | null;
  /**
   * `[D]` Written after a successful load and cleared at the start of the next
   * one. A launch that finds it clear knows the previous load crashed, and
   * offers to start clean -- so a document that crashes the app *during* load
   * cannot trap the player in a loop.
   */
  loadCompleted: boolean;
  savedAt: number;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

export class WorkingStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(): Promise<WorkingStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(new WorkingStore(req.result));
      req.onerror = () => reject(req.error ?? new Error("IndexedDB could not be opened"));
    });
  }

  async read(): Promise<Session | null> {
    const tx = this.db.transaction(STORE, "readonly");
    return (await request(tx.objectStore(STORE).get(KEY))) ?? null;
  }

  async write(session: Session): Promise<void> {
    const tx = this.db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).put(session, KEY));
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).delete(KEY));
  }

  /** Mark the stored session as being loaded; see `Session.loadCompleted`. */
  async markLoading(): Promise<Session | null> {
    const s = await this.read();
    if (s !== null) await this.write({ ...s, loadCompleted: false });
    return s;
  }

  async markLoaded(): Promise<void> {
    const s = await this.read();
    if (s !== null) await this.write({ ...s, loadCompleted: true });
  }
}
