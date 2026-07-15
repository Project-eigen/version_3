import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import api from '../api/client'
import type { User } from '../types'

interface AuthContextType {
  user: User | null
  loading: boolean
  logout: () => void
  refreshUser: () => Promise<void>
  activeMemberId: number
  setActiveMemberId: (id: number) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeMemberId, _setActiveMemberId] = useState<number>(() => {
    const saved = localStorage.getItem('activeMemberId')
    const n = Number(saved)
    return n > 0 ? n : 0
  })

  const setActiveMemberId = (id: number) => {
    _setActiveMemberId(id)
    localStorage.setItem('activeMemberId', String(id))
  }

  const syncTimezone = () => {
    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    const attempt = (): any => {
      api.post('/notifications/timezone', { tz_offset: new Date().getTimezoneOffset(), tz_name: tzName })
        .catch(() => new Promise((r) => setTimeout(r, 5000)).then(attempt))
    }
    attempt()
  }

  const fetchUser = async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const res = await api.get('/auth/me')
      setUser(res.data)
      // Sync the browser timezone so the scheduler fires at the right
      // local time regardless of the user's geographic location.
      syncTimezone()
    } catch (err: any) {
      // Only wipe the token on actual 401 (expired/invalid).
      // Network blips, 5xx, or backend restarts should NOT log the user out.
      if (err?.response?.status === 401) {
        localStorage.removeItem('token')
        setUser(null)
      }
      // Otherwise keep the token — a future page load may succeed.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUser()
  }, [])

  useEffect(() => {
    if (user?.id) {
      const saved = localStorage.getItem('activeMemberId')
      const n = Number(saved)
      if (n > 0 && (n === user.id || user.family_id)) {
        _setActiveMemberId(n)
      } else {
        setActiveMemberId(user.id)
      }
    }
  }, [user])

  const logout = async () => {
    try { await api.post('/auth/logout') } catch {}
    localStorage.removeItem('token')
    localStorage.removeItem('activeMemberId')
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        refreshUser: fetchUser,
        activeMemberId,
        setActiveMemberId,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
