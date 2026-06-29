import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest mode: our custom src/sw.ts is bundled as the service worker.
      // This lets us add push event handlers while keeping all workbox caching rules.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
      injectManifest: {
        // These are the assets that Workbox will precache
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
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
