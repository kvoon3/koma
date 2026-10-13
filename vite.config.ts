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
 * Default build: regular chunked bundle for the Cloudflare deploy.
 * `--mode singlefile`: one self-contained HTML that works offline via file://.
 */
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // Inline the HEIC decoder and every asset into a single HTML.
    ...(mode === 'singlefile' ? [viteSingleFile()] : []),
    // A locally trusted CA (mkcert) for https: the certificate covers every
    // NIC IP on this machine, so a phone that trusts the root once gets no
    // warnings.
    mkcert(),
    // QR code for the LAN address only (localhost, Tailscale and fake-IP
    // virtual adapters are filtered out).
    qrcode({
      filter: (url) => {
        const { hostname } = new URL(url)
        return hostname !== 'localhost' && isRfc1918(hostname)
      },
    }),
  ],
  server: { host: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: mode === 'singlefile'
    ? { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false }
    : { target: 'es2022' },
}))
