import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["better-sqlite3", "@abandonware/noble"],
        output: {
          format: "cjs",
          entryFileNames: "index.cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared")
      }
    }
  },
  preload: {
  build: {
    rollupOptions: {
      output: {
        format: "cjs",
        entryFileNames: "index.js"
      }
    }
  },
  resolve: {
    alias: {
      "@preload": resolve("src/preload"),
      "@shared": resolve("src/shared")
    }
  }
},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react()]
  }
});
