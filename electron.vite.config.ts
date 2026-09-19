import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
    server: {
      host: "127.0.0.1"
    },
    resolve: {
      alias: {
        // Vite matches aliases exact-or-`find + "/"`, so "@" does not swallow
        // "@renderer/*", "@shared/*" or npm scopes like "@radix-ui/*".
        "@": resolve("src/renderer/src"),
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react(), tailwindcss()]
  }
});
