import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

// Lazy-loaded pages — each page becomes its own JS chunk.
// This means the browser only downloads what the user actually navigates to,
// dramatically reducing initial bundle size (TBT) and speeding up first paint (FCP).
const AuthGate      = lazy(() => import('./pages/AuthGate'))
const AuthSuccess   = lazy(() => import('./pages/AuthSuccess'))
const FamilySettings = lazy(() => import('./pages/FamilySettings'))
const Cabinet       = lazy(() => import('./pages/Cabinet'))
const Scanner       = lazy(() => import('./pages/Scanner'))
const ScanApproval  = lazy(() => import('./pages/ScanApproval'))
const FamilyInbox   = lazy(() => import('./pages/FamilyInbox'))
const NotificationSettings = lazy(() => import('./pages/NotificationSettings'))

// Minimal full-screen spinner shown while a lazy chunk is being downloaded.
// Matches the dark background so there's no flash of white (prevents CLS).
function PageSuspense() {
  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
      }}
      aria-label="Loading page"
    >
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
  if (loading) return <PageSuspense />

  return (
    <div className="app-shell">
      <Suspense fallback={<PageSuspense />}>
        <Routes>
          {/* Public */}
          <Route path="/" element={user ? <Navigate to="/home" replace /> : <AuthGate />} />
          <Route path="/auth/success" element={<AuthSuccess />} />

          {/* Protected */}
          <Route path="/home"        element={<ProtectedRoute><FamilySettings /></ProtectedRoute>} />
          <Route path="/cabinet"     element={<ProtectedRoute><Cabinet /></ProtectedRoute>} />
          <Route path="/scan"        element={<ProtectedRoute><Scanner /></ProtectedRoute>} />
          <Route path="/scan/approve" element={<ProtectedRoute><ScanApproval /></ProtectedRoute>} />
          <Route path="/inbox"       element={<ProtectedRoute><FamilyInbox /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationSettings /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
