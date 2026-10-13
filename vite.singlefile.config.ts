import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Standalone build (`bun run build:single`): one self-contained HTML, i.e.
 * koma.html, with the HEIC decoder and every asset inlined so it works fully
 * offline, opened directly via file://.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false },
})
