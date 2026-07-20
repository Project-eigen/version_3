import { useState } from 'react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import BrandLogo from '../components/BrandLogo'

export default function AuthGate() {
  const { refreshUser } = useAuth()
  const [guestLoading, setGuestLoading] = useState(false)
  const [guestError, setGuestError] = useState('')

  const handleLogin = () => {
    const apiBase = import.meta.env.VITE_API_URL || ''
    window.location.href = `${apiBase}/api/auth/google`
  }

  const handleGuestLogin = async () => {
    setGuestLoading(true)
    setGuestError('')
    try {
      const res = await api.post('/auth/guest-login')
      localStorage.setItem('token', res.data.token)
      await refreshUser()
    } catch (err) {
      if (import.meta.env.DEV) console.error('Guest login failed', err)
      setGuestError('Could not start a guest session. Please try again.')
    } finally {
      setGuestLoading(false)
    }
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <BrandLogo variant="mark" size={52} alt="DawaiSathi" />
        </div>

        <h1 className="auth-title">DawaiSathi</h1>
        <p className="auth-subtitle">
          Your family medicine companion.<br />Scan prescriptions and track timing.
        </p>

        <div className="auth-actions-group">
          <button
            type="button"
            className="google-btn"
            onClick={handleLogin}
            id="google-signin-btn"
            aria-label="Continue with Google"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <button
            type="button"
            className="btn-ghost auth-guest-btn"
            onClick={handleGuestLogin}
            disabled={guestLoading}
            id="guest-login-btn"
            aria-describedby={guestError ? 'guest-login-error' : undefined}
          >
            {guestLoading ? 'Starting…' : 'Try guest mode'}
          </button>
        </div>

        {guestError && (
          <p id="guest-login-error" className="field-error-inline" role="alert" style={{ marginTop: '12px' }}>
            {guestError}
          </p>
        )}

        <p className="auth-footer-text">
          Secure sign-in powered by Google Accounts.
        </p>
      </div>
    </div>
  )
}
