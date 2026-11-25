import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port and no screen clearing.
export default defineConfig({
  plugins: [svelte()],
  // GitHub Pages serves the web app from /twilight-games/; the desktop build uses "/".
  base: process.env.WEB_BASE ?? "/",
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist" },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"] },
});
