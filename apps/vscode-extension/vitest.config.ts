import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(rootDir, "src/shared"),
      vscode: path.resolve(rootDir, "test/mocks/vscode.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
