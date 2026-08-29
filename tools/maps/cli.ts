// Thin IO shell (D7): parse-maps <archive-dir> <out-dir>
// Reads the 16 res/maps/* files plus the archive's .version, calls the pure
// parser, and writes one JSON file per tower plus index.json.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTower } from "./parser";
import { mergeFloor } from "./merge";
import { toReviewableJson, type JSONValue } from "./format";
import { TOWER_IDS, type TowerJSON } from "./types";

function main(): void {
  const [archiveDir, outDir] = process.argv.slice(2);
  if (!archiveDir || !outDir) {
    console.error("usage: parse-maps <archive-dir> <out-dir>");
    process.exit(1);
  }

  const gameVersion = readFileSync(join(archiveDir, ".version"), "utf8").trim();

  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as { version: string };
  const generator = `orderlyorderer/tools/maps@${pkg.version}`;

  mkdirSync(outDir, { recursive: true });

  const index: JSONValue[] = [];

  for (const towerId of TOWER_IDS) {
    const bytes = readFileSync(join(archiveDir, "res", "maps", towerId));
    const content = bytes.toString("utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    const parsed = parseTower(towerId, content);

    const tower: TowerJSON = {
      tower_id: towerId,
      game_version: gameVersion,
      content_hash: contentHash,
      generator,
      metadata: parsed.metadata,
      floors: parsed.floors.map((f, i) => mergeFloor(towerId, i + 1, f)),
    };

    writeFileSync(join(outDir, `${towerId}.json`), toReviewableJson(tower as unknown as JSONValue));

    index.push({
      tower_id: towerId,
      name: parsed.metadata.name,
      floor_count: parsed.floors.length,
      content_hash: contentHash,
    });
  }

  writeFileSync(
    join(outDir, "index.json"),
    toReviewableJson({
      game_version: gameVersion,
      generator,
      towers: index,
    }),
  );

  console.log(`parsed ${TOWER_IDS.length} towers -> ${outDir}`);
}

main();
