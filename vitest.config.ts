import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@main": resolve(import.meta.dirname, "src/main"),
      "@preload": resolve(import.meta.dirname, "src/preload"),
      "@renderer": resolve(import.meta.dirname, "src/renderer/src"),
      "@shared": resolve(import.meta.dirname, "src/shared")
    }
  }
});
