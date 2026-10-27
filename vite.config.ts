import type { Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'
import { qrcode } from 'vite-plugin-qrcode'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { voidPlugin } from 'void'

function isRfc1918(host: string) {
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
}

const require = createRequire(import.meta.url)

/** Install dir of a package: resolve its entry, then walk up to the owning package.json. */
function packageDir(id: string, from?: string) {
  const resolve = from ? createRequire(join(from, 'package.json')).resolve : require.resolve
  let dir = dirname(resolve(id))
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir)
      throw new Error(`[koma] cannot find the install dir of ${id}`)
    dir = parent
  }
  return dir
}

const transformersDir = packageDir('@huggingface/transformers')
/**
 * onnxruntime-web is not a dependency of ours: it ships inside the
 * transformers.js graph, and both the wasm glue and the binary must be the
 * exact build that the bundled `transformers.min.js` was compiled against. So
 * it resolves from transformers' scope, not from ours: a copy hoisted to our
 * root would be a different build and would break inference at runtime.
 */
const ortDir = packageDir('onnxruntime-web', transformersDir)

/**
 * Self-host the transformers.js runtime and the onnxruntime wasm it loads, so
 * background removal does not depend on cdn.jsdelivr.net being reachable.
 */
const VENDOR_FILES: Record<string, string> = {
  'transformers.min.js': join(transformersDir, 'dist/transformers.min.js'),
  'ort-wasm-simd-threaded.mjs': join(ortDir, 'dist/ort-wasm-simd-threaded.mjs'),
  'ort-wasm-simd-threaded.wasm': join(ortDir, 'dist/ort-wasm-simd-threaded.wasm'),
}

function vendorRuntime(): Plugin {
  const read = (name: string) => {
    const path = VENDOR_FILES[name]
    if (!existsSync(path))
      throw new Error(`[koma] missing ${name} at ${path}: the vendor runtime moved, update VENDOR_FILES`)
    return readFileSync(path)
  }
  return {
    name: 'koma:vendor-runtime',
    configureServer(server) {
      server.middlewares.use('/vendor/', (req, res, next) => {
        const name = req.url?.slice(1).split('?')[0] ?? ''
        if (!(name in VENDOR_FILES))
          return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of Object.keys(VENDOR_FILES))
        this.emitFile({ type: 'asset', fileName: `vendor/${name}`, source: read(name) })
    },
  }
}

/**
 * `vite build` → regular chunked bundle for the Cloudflare deploy and the
 * mygo desktop shell. `vite build --mode single` (bun run build:single) →
 * one self-contained koma.html with the HEIC decoder and every asset
 * inlined so it works fully offline, opened directly via file://.
 */
export default defineConfig(({ command, mode }) => {
  const single = mode === 'single'
  return {
    base: './',
    // Vite DevTools dock (`@vitejs/devtools`, requires Vite 8.3+): the
    // `apply: 'serve'` keeps it strictly on the dev server, so neither
    // `vite build` nor `build:single` output is touched.
    devtools: { apply: 'serve' },
    plugins: [
      // The dev server and the `--mode void` build run routes/ on Cloudflare's
      // runtime. Every other build (plain chunked, single-file koma.html) is a
      // client artifact: voidPlugin there would relocate the output to
      // dist/client and bundle a worker graph the consumer discards.
      !single && (command === 'serve' || mode === 'void') && voidPlugin(),
      react(),
      tailwindcss(),
      vendorRuntime(),
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
