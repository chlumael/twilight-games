import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port and no screen clearing.
export default defineConfig({
  plugins: [svelte()],
  // 만든 시각: PC판이 "같은 버전 번호인데 고친 설치 파일이 새로 올라왔는지" 알아보는 데 쓴다(사용자 2026-11-27)
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  // GitHub Pages serves the web app from /twilight-games/; the desktop build uses "/".
  base: process.env.WEB_BASE ?? "/",
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", outDir: "dist" },
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"] },
});
