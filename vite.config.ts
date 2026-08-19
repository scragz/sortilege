import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    // Emit fonts and any AudioWorklet as real files rather than inlining them
    // as data: URLs. Mobile Safari is unreliable loading worklets from data:/blob:.
    assetsInlineLimit: 0,
  },
});
