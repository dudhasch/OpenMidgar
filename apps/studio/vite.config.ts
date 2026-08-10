import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
    fs: {
      allow: ['..', '../..'],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@webmidgar/studio-core": path.resolve(__dirname, "../../packages/studio-core/src/index.ts"),
      "@webmidgar/studio-compiler": path.resolve(__dirname, "../../packages/studio-compiler/src/index.ts"),
    },
  },
  build: {
    outDir: 'dist',
  },
});
