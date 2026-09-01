// SPEC-007 §1 — the React root. Chrome only; the canvas owns itself.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

const el = document.getElementById("root");
if (!el) throw new Error("no #root");
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
