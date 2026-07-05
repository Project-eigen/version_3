/// <reference lib="WebWorker" />
/// <reference types="vite-plugin-pwa/client" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

// ── Precache all Vite-built assets ────────────────────────────────────────────
// self.__WB_MANIFEST is injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── Runtime caching: API calls (NetworkFirst, 24h) ────────────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 8,
    plugins: [
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 86400 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
)

// ── Runtime caching: Medicine/prescription images (CacheFirst, 30 days) ───────
registerRoute(
  ({ url }) => url.pathname.startsWith('/uploads/'),
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 2592000 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
)

// ── Runtime caching: Google Fonts ────────────────────────────────────────────
registerRoute(
  ({ url }) => url.hostname === 'fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' })
)
registerRoute(
  ({ url }) => url.hostname === 'fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 31536000 }),
    ],
  })
)

// ── Periodic background sync for medicine reminders ───────────────────────────
// Fired by the browser periodically (interval set during page registration).
// Tries to fetch fresh cabinet data. If the app is open, the NetworkFirst
// strategy will serve the latest. If offline/unauth'd, it's a silent no-op.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'medicine-check') {
    event.waitUntil(
      fetch(new Request('/api/notifications/settings', { mode: 'same-origin' }))
        .catch(() => {})
    )
  }
})

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload: {
    title?: string
    body?: string
    icon?: string
    badge?: string
    data?: { url?: string }
  } = {}

  try {
    payload = event.data.json()
  } catch {
    payload = { title: '💊 DawaiSathi', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? '💊 DawaiSathi', {
      body: payload.body ?? '',
      icon: payload.icon ?? '/pwa-192x192.png',
      badge: payload.badge ?? '/pwa-192x192.png',
      data: payload.data ?? {},
      // tag ensures a new notification replaces the old one (no pile-up)
      tag: 'medicine-reminder',
      renotify: true,
    })
  )
})

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl: string = (event.notification.data as { url?: string })?.url ?? '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // If the app is already open, navigate it to the target URL
        for (const client of clients) {
          if ('focus' in client) {
            client.focus()
            ;(client as WindowClient).navigate(targetUrl)
            return
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl)
      })
  )
})
