import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AnimatePresence } from 'framer-motion'
import PageTransition from './components/PageTransition'
import api from './api/client'

// Lazy-loaded pages — each page becomes its own JS chunk.
// This means the browser only downloads what the user actually navigates to,
// dramatically reducing initial bundle size (TBT) and speeding up first paint (FCP).
const AuthGate      = lazy(() => import('./pages/AuthGate'))
const AuthSuccess   = lazy(() => import('./pages/AuthSuccess'))
const FamilySettings = lazy(() => import('./pages/FamilySettings'))
const SettingsDashboard = lazy(() => import('./pages/SettingsDashboard'))
const Cabinet       = lazy(() => import('./pages/Cabinet'))
const Scanner       = lazy(() => import('./pages/Scanner'))
const ScanApproval  = lazy(() => import('./pages/ScanApproval'))

// Minimal full-screen spinner shown while a lazy chunk is being downloaded.
// Matches the dark background so there's no flash of white (prevents CLS).
function PageSuspense() {
  return (
    <div className="loading-overlay" style={{ height: '100dvh' }} aria-busy="true" aria-label="Loading page">
      <div className="loading-spinner" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageSuspense />
  if (!user) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user, loading } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (!user) return

    const runSync = async () => {
      try {
        // 1. Open local database and fetch local logs
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('dawaisathi-offline', 1)
          req.onupgradeneeded = (e: any) => {
            const dbObj = e.target.result
            if (!dbObj.objectStoreNames.contains('logs')) {
              dbObj.createObjectStore('logs', { keyPath: 'id' })
            }
            if (!dbObj.objectStoreNames.contains('schedules')) {
              dbObj.createObjectStore('schedules')
            }
          }
          req.onsuccess = (e: any) => resolve(e.target.result)
          req.onerror = (e: any) => reject(e.target.error)
        })

        const logsList = await new Promise<any[]>((resolve, reject) => {
          const tx = db.transaction('logs', 'readonly')
          const store = tx.objectStore('logs')
          const req = store.getAll()
          req.onsuccess = () => resolve(req.result || [])
          req.onerror = () => reject(req.error)
        })

        // 2. Push any offline-triggered notification logs to the server
        if (logsList.length > 0) {
          const syncResp = await api.post('/notifications/sync', { logs: logsList })
          if (syncResp.data.ok) {
            const idsToClear = logsList.map(l => l.id)
            try {
              await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('logs', 'readwrite')
                const store = tx.objectStore('logs')
                idsToClear.forEach(id => store.delete(id))
                tx.oncomplete = () => resolve()
                tx.onerror = (e: any) => reject(e.target.error)
              })
            } catch (e) {
              if (import.meta.env.DEV) console.error('[App] Failed to clear synced logs:', e)
            }
          }
        }

        // 3. Cabinet double-fetching removed on mount (now synchronized in Cabinet.tsx)
      } catch (err) {
        if (import.meta.env.DEV) console.error('[App] Notification sync failed:', err)
      }
    }

    runSync()
  }, [user])

  if (loading) return <PageSuspense />

  return (
    <div className="app-shell">
      <Suspense fallback={<PageSuspense />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            {/* Public */}
            <Route path="/" element={user ? <Navigate to="/home" replace /> : <PageTransition><AuthGate /></PageTransition>} />
            <Route path="/auth/success" element={<PageTransition><AuthSuccess /></PageTransition>} />

            {/* Protected */}
            <Route path="/home"        element={<ProtectedRoute><PageTransition><FamilySettings /></PageTransition></ProtectedRoute>} />
            <Route path="/settings"    element={<ProtectedRoute><PageTransition><SettingsDashboard /></PageTransition></ProtectedRoute>} />
            <Route path="/cabinet"     element={<ProtectedRoute><PageTransition><Cabinet /></PageTransition></ProtectedRoute>} />
            <Route path="/scan"        element={<ProtectedRoute><PageTransition><Scanner /></PageTransition></ProtectedRoute>} />
            <Route path="/scan/approve" element={<ProtectedRoute><PageTransition><ScanApproval /></PageTransition></ProtectedRoute>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
