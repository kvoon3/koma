// Native Void shape: routes/ handlers plus the Vite SPA client. Void's
// builder owns the worker entry and the asset layer; this file names the
// Worker, the domain and the dashboard-managed visibility, and nothing else.
// The old passthrough shape (cloudflare.main, cloudflare.assets) is what
// `void deploy` silently built as a Static SPA, dropping the proxy.
import { defineConfig } from 'void/config'

export default defineConfig({
  // void's default build step is a bare `vite build`; point it at the repo
  // script so a deploy is gated on the typecheck like `bun run build` is.
  inference: {
    build: 'bun run build',
  },
  routing: {
    // The client owns routing; unmatched paths fall back to index.html.
    notFound: 'single-page-application',
  },
  cloudflare: {
    name: 'koma',
    compatibility_date: '2026-10-11',
    // Mirrors the dashboard-managed preview settings; declared so void does
    // not flip them.
    preview_urls: true,
    previews: {},
    // The dashboard had the workers.dev subdomain disabled (it 404s); declared
    // so void does not silently flip dashboard-managed visibility.
    workers_dev: false,
    routes: [
      { pattern: 'koma.kvoon.me', custom_domain: true },
    ],
  },
})
