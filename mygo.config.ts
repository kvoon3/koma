import { defineConfig } from 'mygo-cli'

export default defineConfig({
  name: 'koma',
  identifier: 'me.kvoon.koma',
  version: '1.0.0',
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: 'https://localhost:5173', // vite-plugin-mkcert serves https
  devCommand: 'bun run dev',
  buildCommand: 'bun run build',
  frontendDist: 'dist',
  out: 'build',
})
