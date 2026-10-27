// Migrated from the root wrangler.jsonc by `void migrate`. The whole
// Cloudflare config passes through the `cloudflare` key unchanged; `void
// deploy` emits it to .void-wrangler.jsonc (gitignored) for the Cloudflare
// API. wrangler.jsonc stays in the repo until Workers Builds (merge deploys
// and branch previews) moves to void, so the two files must not drift.
import { defineConfig } from 'void/config'

export default defineConfig({
  // void deploy builds a Static SPA and drops `main` (verified twice on
  // production), so it stays out of the pipeline. `void connect` regenerates
  // .void-wrangler.jsonc from this file and wrangler deploys that emission
  // until the proxy becomes a void-native route.
  cloudflare: {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'koma',
    compatibility_date: '2026-10-11',
    // Branch Previews (wrangler preview / Workers Builds preview builds)
    preview_urls: true,
    previews: {},
    // The dashboard had the workers.dev subdomain disabled (it 404s); declared
    // so void does not silently flip dashboard-managed visibility.
    workers_dev: false,
    // The Worker holds the Jev key and serves the SPA assets through ASSETS.
    main: 'worker/index.ts',
    assets: {
      directory: './dist',
      binding: 'ASSETS',
      // SPA fallback: serve index.html for all unmatched routes
      not_found_handling: 'single-page-application',
      // Only the proxy path pays a Worker invocation. Assets, including the SPA
      // fallback, keep serving directly, so a Worker fault cannot take the app
      // down with it.
      run_worker_first: ['/api/jev'],
    },
    // Custom domain (deploy auto-creates the DNS record in the kvoon.me zone)
    routes: [
      { pattern: 'koma.kvoon.me', custom_domain: true },
    ],
  },
})
