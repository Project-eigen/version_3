import { useNavigate } from 'react-router-dom'
import { Pill, Settings } from 'lucide-react'

export default function Header() {
  const navigate = useNavigate()

  return (
    <header className="app-header" role="banner">
      {/* Brand - Clickable to navigate back to Cabinet */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => navigate('/cabinet')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && navigate('/cabinet')}
        aria-label="DawaiSathi brand logo, click to view cabinet"
      >
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: 'linear-gradient(135deg, var(--accent-teal), #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Pill size={16} color="white" />
        </div>
        <span className="brand-text">DawaiSathi</span>
      </div>

      {/* Header Actions - Settings Cog */}
      <div className="header-actions">
        <button
          onClick={() => navigate('/settings')}
          className="icon-btn"
          aria-label="Open settings dashboard"
          style={{
            width: 36, height: 36, display: 'flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 8, background: 'transparent',
            border: 'none', color: 'var(--text-secondary)', cursor: 'pointer'
          }}
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  )
}
