import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, ShieldAlert, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Sparkles, Utensils } from 'lucide-react'
import api from '../api/client'

interface Interaction {
  pair: [string, string]
  severity: 'severe' | 'moderate' | 'info'
  title: string
  description: string
  recommendation: string
}

interface InteractionResult {
  severity: 'safe' | 'moderate' | 'severe'
  summary: string
  interactions: Interaction[]
  food_advice?: string[]
}

interface InteractionCheckerCardProps {
  userId: number
  refreshTrigger?: number
}

export default function InteractionCheckerCard({ userId, refreshTrigger }: InteractionCheckerCardProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<InteractionResult | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(false)

  const checkInteractions = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await api.post('/medicine/check-interactions', { user_id: userId })
      setResult(res.data)
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to run interaction check', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    checkInteractions()
  }, [checkInteractions, refreshTrigger])

  if (loading && !result) {
    return (
      <div className="interaction-card loading-state">
        <div className="interaction-header">
          <Sparkles className="spin-icon text-teal" size={20} />
          <span className="interaction-title">AI Drug Safety Shield Analyzing…</span>
        </div>
      </div>
    )
  }

  if (error || !result) {
    return null
  }

  const isSevere = result.severity === 'severe'
  const isModerate = result.severity === 'moderate'
  const hasInteractions = result.interactions && result.interactions.length > 0

  return (
    <div className={`interaction-card ${result.severity}-theme`}>
      <div className="interaction-top-row">
        <div className="interaction-badge-group">
          {isSevere ? (
            <ShieldAlert className="shield-icon severe-color" size={22} />
          ) : isModerate ? (
            <AlertTriangle className="shield-icon moderate-color" size={22} />
          ) : (
            <ShieldCheck className="shield-icon safe-color" size={22} />
          )}

          <div className="interaction-title-group">
            <div className="interaction-header-label">
              <span>AI Drug Safety Shield</span>
              <span className={`severity-tag ${result.severity}-tag`}>
                {isSevere ? 'Conflict Risk' : isModerate ? 'Caution Advised' : 'No Conflicts'}
              </span>
            </div>
            <p className="interaction-summary">{result.summary}</p>
          </div>
        </div>

        <button
          type="button"
          className="recheck-btn"
          onClick={checkInteractions}
          disabled={loading}
          title="Re-analyze cabinet safety"
          aria-label="Re-analyze medicine safety"
        >
          <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
        </button>
      </div>

      {(hasInteractions || (result.food_advice && result.food_advice.length > 0)) && (
        <div className="interaction-expand-section">
          <button
            type="button"
            className="toggle-details-btn"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <span>{expanded ? 'Hide Safety Details' : `View ${result.interactions.length} Safety Note(s)`}</span>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {expanded && (
            <div className="interaction-details-body">
              {hasInteractions && (
                <div className="conflicts-list">
                  {result.interactions.map((item, i) => (
                    <div key={i} className={`conflict-item ${item.severity}-item`}>
                      <div className="conflict-header">
                        <span className="conflict-pair">
                          {item.pair ? item.pair.join(' + ') : item.title}
                        </span>
                        <span className={`conflict-badge ${item.severity}-badge`}>
                          {item.severity.toUpperCase()}
                        </span>
                      </div>
                      <p className="conflict-desc">{item.description}</p>
                      {item.recommendation && (
                        <div className="conflict-advice">
                          <strong>Advice:</strong> {item.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {result.food_advice && result.food_advice.length > 0 && (
                <div className="food-advice-block">
                  <div className="food-advice-header">
                    <Utensils size={14} className="text-teal" />
                    <span>Food & Timing Guidelines</span>
                  </div>
                  <ul className="food-advice-list">
                    {result.food_advice.map((advice, idx) => (
                      <li key={idx}>{advice}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
