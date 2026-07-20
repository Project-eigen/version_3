/**
 * Brand logo — Imagine mark for product surfaces.
 * - mark: app icon (header, small UI)
 * - wordmark: full logo with name (auth / marketing)
 * - circle: circular badge variant
 */

type BrandVariant = 'mark' | 'wordmark' | 'circle'

interface BrandLogoProps {
  variant?: BrandVariant
  className?: string
  /** Accessible name when used as decorative vs standalone */
  alt?: string
  size?: number
}


export default function BrandLogo({
  variant = 'mark',
  className = '',
  alt = 'DawaiSathi',
  size = 32,
}: BrandLogoProps) {
  
  const renderSvg = () => (
    <svg 
      className={className}
      viewBox="0 0 32 32" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: size, height: size, display: 'block', flexShrink: 0 }}
      aria-label={alt}
    >
      <defs>
        {/* Soft Indigo/Blue Gradient for top half of pill */}
        <linearGradient id="pill-top-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        {/* Modern Teal/Mint Gradient for bottom half of pill */}
        <linearGradient id="pill-bot-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
        {/* Gentle shadows for premium feel */}
        <filter id="pill-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#0f172a" floodOpacity="0.12" />
        </filter>
      </defs>

      <g filter="url(#pill-shadow)">
        {/* Top Capsule Cap */}
        <path d="M16 4C11.58 4 8 7.58 8 12V16H24V12C24 7.58 20.42 4 16 4Z" fill="url(#pill-top-grad)" />
        {/* Bottom Capsule Cap */}
        <path d="M8 16V20C8 24.42 11.58 28 16 28C20.42 28 24 24.42 24 20V16H8Z" fill="url(#pill-bot-grad)" />
      </g>
      
      {/* Intersecting division band */}
      <line x1="8" y1="16" x2="24" y2="16" stroke="white" strokeWidth="1.5" />
      
      {/* Smiling companion eyes inside top half */}
      <circle cx="13" cy="11.5" r="1.2" fill="white" />
      <circle cx="19" cy="11.5" r="1.2" fill="white" />
      
      {/* Friendly companion smile inside bottom half */}
      <path 
        d="M13.5 20.5C14 21.8 15 22.5 16 22.5C17 22.5 18 21.8 18.5 20.5" 
        stroke="white" 
        strokeWidth="1.8" 
        strokeLinecap="round" 
      />
    </svg>
  )

  if (variant === 'circle') {
    return (
      <div 
        className={`brand-logo-circle ${className}`}
        style={{ 
          width: size + 18, 
          height: size + 18, 
          borderRadius: '50%', 
          background: 'var(--bg-secondary)',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {renderSvg()}
      </div>
    )
  }

  if (variant === 'wordmark') {
    return (
      <div 
        className={`brand-logo-wordmark-wrap ${className}`} 
        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        {renderSvg()}
        <span 
          className="brand-text" 
          style={{ 
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: size * 0.65, 
            letterSpacing: '-0.5px',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center'
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>Dawai</span>
          <span style={{ color: 'var(--accent-teal)', marginLeft: '1px' }}>Sathi</span>
        </span>
      </div>
    )
  }

  return renderSvg()
}
