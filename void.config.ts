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
    // A void deploy builds with `vite build --mode void` (the only build whose
    // output shape voidPlugin emits), gated on the same typecheck as the repo
    // build; plain `vite build` stays client-shaped for the mygo desktop shell.
    build: 'bun run build:void',
  },
  routing: {
    // The client owns routing; unmatched paths fall back to index.html.
    notFound: 'single-page-application',
  },
  cloudflare: {
    name: 'koma',
    // void's own CI note: the Actions deploy needs it here, because the
    // fresh checkout has none of the gitignored .void state that carries it.
    account_id: '28a23c2ec9aeeb01a95276f1d9ca42df',
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
