import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
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
    return saved ? Number(saved) : 0
  })

  const setActiveMemberId = (id: number) => {
    _setActiveMemberId(id)
    localStorage.setItem('activeMemberId', String(id))
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
      // Silently keep the backend's timezone in sync with the browser.
      // This ensures the scheduler fires notifications at the right local time.
      api.post('/notifications/timezone', { tz_offset: new Date().getTimezoneOffset() }).catch(() => {})
    } catch {
      localStorage.removeItem('token')
      setUser(null)
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
      if (saved) {
        _setActiveMemberId(Number(saved))
      } else {
        setActiveMemberId(user.id)
      }
    }
  }, [user])

  const logout = async () => {
    try { await api.post('/auth/logout') } catch {}
    localStorage.removeItem('token')
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
