import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Tear down the inline boot splash once React paints. Tuned for "barely felt"
// presence — 90ms in, ~40ms hold, 200ms ease-out fade with a tiny scale + blur
// so the glyph dissolves rather than blinks off. Total ~330ms.
const splash = document.getElementById("daisu-splash");
if (splash) {
  window.setTimeout(() => {
    splash.dataset["leaving"] = "1";
    window.setTimeout(() => splash.remove(), 200);
  }, 40);
}
