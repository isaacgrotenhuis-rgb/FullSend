import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["better-sqlite3", "@abandonware/noble"]
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
