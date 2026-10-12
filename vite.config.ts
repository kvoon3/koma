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

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    // 本地受信 CA（mkcert）签发证书启用 https：证书自动覆盖本机所有网卡 IP，
    // 手机安装一次根证书后访问无警告
    mkcert(),
    // 只显示局域网地址的二维码（排除 localhost、Tailscale、fake-IP 等虚拟网卡）
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
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false },
})
