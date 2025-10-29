// vite.config.js
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      crypto: "crypto-browserify",
      stream: "stream-browserify",
      os: "os-browserify/browser",
      path: "path-browserify",
    },
  },
  build: {
    // makes esbuild OK with modern syntax and avoids top-level-await issues
    target: "esnext",
    // optional, silences the big bundle warning
    chunkSizeWarningLimit: 3000,
  },
  // dev server proxy so frontend can call /api/* while a local API shim runs on :8787
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
