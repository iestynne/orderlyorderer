import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { basePath, devPort } from "./tools/worktree";

// No backend (CLAUDE.md). build/ holds the game art and is gitignored; the
// atlas is imported with ?inline so it lands in the bundle rather than being
// emitted as a fetchable asset (SPEC-007 §6.1, D14b-1).
//
// The `.sav` codec is SPEC-006's, written for Node and byte-exact against the
// shipped saves. It is frozen, so the browser build aliases node:zlib to a
// synchronous shim rather than reshaping it. See src/sav/zlib-browser.ts.
export default defineConfig(({ command }) => ({
  // `[F]` In dev the URL path names the worktree, so a tab says which session
  // drew it. A build has no worktree to speak of and is served from wherever it
  // is deployed, so it takes `BASE_PATH` — `/orderlyorderer/` for a GitHub
  // Pages project site — and `/` when nothing says otherwise. An absolute asset
  // path must go through `import.meta.env.BASE_URL` to survive either
  // (src/ui/dev.ts).
  base: process.env["BASE_PATH"] ?? (command === "serve" ? basePath() : "/"),
  plugins: [react()],
  resolve: {
    alias: [{ find: /^node:zlib$/, replacement: fileURLToPath(new URL("./src/sav/zlib-browser.ts", import.meta.url)) }],
  },
  // One port per worktree, from the same name as the base path (D47). The host
  // matters more than the port: on "localhost" — which resolves to `[::1]` here
  // — Vite's probe and its bind can disagree, and it takes a neighbour's port.
  // Loopback only either way, per CLAUDE.md.
  server: { host: "127.0.0.1", port: devPort() },
  build: { assetsInlineLimit: 1024 * 1024, target: "es2022" },
}));
