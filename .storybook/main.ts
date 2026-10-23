import type { Plugin, PluginOption } from 'vite'
import { defineMain } from '@storybook/react-vite/node'

/**
 * The plugins the app's Vite config adds for its own dev server: a mkcert
 * certificate, a LAN QR code, and the vendored transformers runtime. Storybook
 * serves its own HTTPS-less iframe and mounts no worker, so they only add
 * startup work here. React and Tailwind stay, because every story needs them.
 */
const APP_DEV_PLUGINS = new Set([
  'vite:plugin:mkcert',
  'vite-plugin-qrcode',
  'koma:vendor-runtime',
])

function withoutAppDevPlugins(plugins: PluginOption[] | undefined): PluginOption[] {
  return (plugins ?? []).flatMap((plugin) => {
    if (Array.isArray(plugin))
      return withoutAppDevPlugins(plugin)
    if (plugin && typeof plugin === 'object' && 'name' in plugin && APP_DEV_PLUGINS.has((plugin as Plugin).name))
      return []
    return [plugin]
  })
}

export default defineMain({
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  viteFinal(config) {
    config.plugins = withoutAppDevPlugins(config.plugins)
    return config
  },
})
