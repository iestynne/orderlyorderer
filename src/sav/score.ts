// The game's `score` and `crown` files: plain alternating lines of tower name
// and value, read from the player's save folder. GAME_MECHANICS.md §6.1.
//
// Note the names are singular and extension-less. `scores.lua` is the game's
// source and holds no data.

export type ScoreTable = Map<string, number>;

export function parseScoreFile(text: string): ScoreTable {
  const lines = text.split(/\r?\n/);
  const out: ScoreTable = new Map();
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const name = lines[i]!;
    if (name === "") break;
    const raw = lines[i + 1]!;
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new Error(`score file: "${name}" has non-numeric value ${JSON.stringify(raw)}`);
    out.set(name, v);
  }
  return out;
}
