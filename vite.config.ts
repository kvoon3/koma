import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'
import { qrcode } from 'vite-plugin-qrcode'
import { viteSingleFile } from 'vite-plugin-singlefile'

function isRfc1918(host: string) {
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
}

/**
 * `vite build` → regular chunked bundle for the Cloudflare deploy and the
 * mygo desktop shell. `vite build --mode single` (bun run build:single) →
 * one self-contained koma.html with the HEIC decoder and every asset
 * inlined so it works fully offline, opened directly via file://.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      // A locally trusted CA (mkcert) for https: the certificate covers every
      // NIC IP on this machine, so a phone that trusts the root once gets no
      // warnings. Dev-server only (apply: serve).
      mkcert(),
      // QR code for the LAN address only (localhost, Tailscale and fake-IP
      // virtual adapters are filtered out). Dev-server only.
      qrcode({
        filter: (url) => {
          const { hostname } = new URL(url)
          return hostname !== 'localhost' && isRfc1918(hostname)
        },
      }),
      single && viteSingleFile(),
    ],
    server: { host: true, watch: { ignored: ['**/build/**', '**/.mygo/**'] } },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: single
      ? { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false }
      : { target: 'es2022' },
  }
})
