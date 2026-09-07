// SPEC-009 §4 — walk the shots that moved and bless them one at a time.
//
//   npm run bless
//
// Takes the shots once, opens each moved one's review sheet, waits for a key.
// Blesses the exact bytes that were looked at — never re-shoots — and writes
// nothing until the walk finishes, so quitting leaves every golden as it was.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_DIR, SHOTS_DIR, runAll, type Result } from "./run";

/** Show a PNG in whatever the desktop uses. Local file, no network. */
function open(file: string): void {
  const cmd =
    process.platform === "win32"
      ? { exe: "cmd", args: ["/c", "start", "", file] }
      : { exe: process.platform === "darwin" ? "open" : "xdg-open", args: [file] };
  spawn(cmd.exe, cmd.args, { detached: true, stdio: "ignore" }).unref();
}

/** One keypress, unbuffered, so a review is one key per shot and no Enter. */
async function key(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("bless needs a terminal: run it directly, not through a pipe");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((done) => {
    stdin.once("data", (buf: Buffer) => {
      stdin.setRawMode(false);
      stdin.pause();
      done(buf.toString("utf8"));
    });
  });
}

function verdict(r: Result): string {
  if (r.goldenMissing) return "never blessed";
  if (r.differing === -1) return "SIZE MISMATCH";
  return `${r.differing} differing pixels, first at ${r.first?.x},${r.first?.y}`;
}

async function main(): Promise<void> {
  const results = await runAll([], false);
  const moved = results.filter((r) => r.differing !== 0);
  const same = results.length - moved.length;

  console.log(`\n${same} of ${results.length} unchanged.`);
  if (moved.length === 0) {
    console.log("Nothing to review.");
    return;
  }

  console.log(
    `${moved.length} to review. For each: [y] bless  [n] leave  [a] bless all remaining  [q] stop\n` +
      "The review sheet opens in your image viewer: golden on top, then the shot, then the diff.\n",
  );

  const accepted: Result[] = [];
  let all = false;
  for (const [i, r] of moved.entries()) {
    if (all) {
      accepted.push(r);
      continue;
    }
    // A shot with no golden has no review sheet to open — there is nothing to
    // compare it against, so the shot itself is what there is to look at.
    open(join(SHOTS_DIR, r.goldenMissing ? `${r.name}.png` : `${r.name}.review.png`));
    process.stdout.write(`  [${i + 1}/${moved.length}] ${r.name.padEnd(20)} ${verdict(r)}  ? `);
    const k = (await key()).toLowerCase();
    if (k === "" || k === "q") {
      console.log("\nstopped; nothing written.");
      return;
    }
    if (k === "a") {
      all = true;
      accepted.push(r);
      console.log("bless all");
      continue;
    }
    console.log(k === "y" ? "blessed" : "left alone");
    if (k === "y") accepted.push(r);
  }

  for (const r of accepted) writeFileSync(join(GOLDEN_DIR, `${r.name}.png`), r.png);
  console.log(
    `\n${accepted.length} golden(s) written, ${moved.length - accepted.length} left as they were.` +
      (accepted.length > 0 ? "\nCommit them with the change that made them move." : ""),
  );
}

void main().catch((e: Error) => {
  console.error(String(e));
  process.exitCode = 1;
});
