import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // selfDestroying was true — this was destroying the SW immediately after install,
      // which disabled ALL caching. Fixed to false.
      selfDestroying: false,
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'DawaiSathi — Family Medicine Tracker',
        short_name: 'DawaiSathi',
        description: 'AI-powered family medicine management — scan, track, and schedule medicines for your whole family.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache all static assets (JS, CSS, HTML, images, fonts)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],

        // Aggressively precache the app shell
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          // ─── API calls (relative /api/*) ────────────────────────────────
          // Uses NetworkFirst: tries network, falls back to cache (24h)
          // Matches any origin — works on localhost, tunnel, and production
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 86400, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },

          // ─── Medicine / prescription images (/uploads/*) ─────────────────
          // Uses CacheFirst: serve from cache immediately, very fast on repeat visits
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 2592000, // 30 days (up from 7)
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },

          // ─── Google Fonts (if ever added) ─────────────────────────────────
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 31536000, // 1 year
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
    },
  },
  build: {
    // Generate source maps for debugging but keep bundle lean
    sourcemap: false,
    rollupOptions: {
      output: {
        // Manual chunk splitting to reduce initial bundle size (improves TBT)
        manualChunks: {
          // React core — always needed
          'react-vendor': ['react', 'react-dom'],
          // Router — needed on first load
          'router': ['react-router-dom'],
          // Icons — large library, separate chunk
          'icons': ['lucide-react'],
          // Axios — API calls
          'axios': ['axios'],
        },
      },
    },
    // Warn if any chunk exceeds 300KB
    chunkSizeWarningLimit: 300,
  },
})
