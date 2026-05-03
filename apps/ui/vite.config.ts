import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const devPort = Number(process.env.TAURI_DEV_PORT ?? 5173);

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: devPort,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/crates/**", "**/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 2048,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    alias: [
      // Vitest doesn't run vite's worker plugin, so `?worker` imports fail
      // to resolve. Map each Monaco worker entry to a no-op stub. Specific
      // aliases must come BEFORE the broad "monaco-editor" entry.
      ...[
        "monaco-editor/esm/vs/editor/editor.worker?worker",
        "monaco-editor/esm/vs/language/json/json.worker?worker",
        "monaco-editor/esm/vs/language/css/css.worker?worker",
        "monaco-editor/esm/vs/language/html/html.worker?worker",
        "monaco-editor/esm/vs/language/typescript/ts.worker?worker",
      ].map((find) => ({
        find,
        replacement: fileURLToPath(
          new URL("./tests/__mocks__/worker-stub.ts", import.meta.url),
        ),
      })),
      {
        find: "monaco-editor",
        replacement: fileURLToPath(
          new URL("./tests/__mocks__/monaco-editor.ts", import.meta.url),
        ),
      },
    ],
  },
}));
