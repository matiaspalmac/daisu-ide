import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPort = Number(process.env.TAURI_DEV_PORT ?? 5173);

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
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
  },
}));
