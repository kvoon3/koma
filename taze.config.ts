import { defineConfig } from 'taze'

export default defineConfig({
  // typescript-eslint only supports the TS 6 JavaScript API (peer: >=4.8.4 <6.1.0).
  // Drop this exclude once typescript-eslint supports TS 7.
  exclude: ['typescript@>=7'],
})
