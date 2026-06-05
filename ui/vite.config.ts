/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Castor UI build config.
// - base '/'              : SPA served from the Go binary root.
// - build.outDir          : emit into the Go embed bridge so `go:embed dist` picks it up.
//                           In CI the node stage runs `vite build` (outDir below) and the
//                           Go stage embeds server/web/dist.
// - server.proxy          : in `vite dev`, forward /api and /ws to the running Go server.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "../server/web/dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split heavy, independently-cacheable vendors so the main chunk stays lean.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: false,
        // The WS endpoint lives at /api/v1/ws, so the /api proxy entry must
        // upgrade WebSocket connections during `vite dev` (BUG#3).
        ws: true,
      },
      "/ws": {
        target: "http://localhost:8080",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
