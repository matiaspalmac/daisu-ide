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

// Tear down the inline boot splash once React paints. 320ms hold + 320ms
// fade out feels like a deliberate breath, not a stutter.
const splash = document.getElementById("daisu-splash");
if (splash) {
  window.setTimeout(() => {
    splash.dataset["leaving"] = "1";
    window.setTimeout(() => splash.remove(), 320);
  }, 320);
}
