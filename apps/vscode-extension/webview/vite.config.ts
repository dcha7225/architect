import fs from "node:fs/promises";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function copyMonacoAssets(): Plugin {
  const sourceDir = path.resolve(__dirname, "../../../node_modules/monaco-editor/min/vs");
  const targetDir = path.resolve(__dirname, "../dist/webview/vendor/monaco/vs");

  return {
    name: "copy-monaco-assets",
    apply: "build",
    async writeBundle() {
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react(), copyMonacoAssets()],
  base: "./",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../src/shared"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/webview"),
    emptyOutDir: true,
  },
});
