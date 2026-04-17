import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg', 'pwa-192.png', 'pwa-512.png', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Lingread',
        short_name: 'Lingread',
        description: 'Reading app with bionic text and annotations',
        theme_color: '#002b36',
        background_color: '#002b36',
        display: 'standalone',
        orientation: 'any',
        scope: './',
        start_url: './',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,mjs,wasm}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: './',
})
