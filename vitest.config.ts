import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const alias = {
  "@": resolve(import.meta.dirname, "src/renderer/src"),
  "@main": resolve(import.meta.dirname, "src/main"),
  "@preload": resolve(import.meta.dirname, "src/preload"),
  "@renderer": resolve(import.meta.dirname, "src/renderer/src"),
  "@shared": resolve(import.meta.dirname, "src/shared")
};

/* Two projects, one alias map.
   The split is not cosmetic: the main-process suites load better-sqlite3 and
   @abandonware/noble, which are native addons built against a specific ABI
   (scripts/ensure-native-build.mjs swaps them between the electron and node
   builds; `pretest` runs it for `npm test`, a bare `npx vitest` needs it run
   by hand). Loading those under jsdom crashes the worker, so the renderer
   project is scoped to src/renderer and never sees them. */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts", "src/shared/**/*.test.ts"]
        }
      },
      {
        // The React plugin has to be registered on the project rather than at
        // the root, or .tsx test files reach esbuild without the JSX
        // transform and fail to parse.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/renderer/**/*.test.ts", "src/renderer/**/*.test.tsx"],
          setupFiles: ["./src/renderer/test/setup.ts"]
        }
      }
    ]
  }
});
