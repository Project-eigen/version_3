import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import AppLayout from '../components/AppLayout'
import api from '../api/client'
import {
  Bell, RefreshCw, LogOut, ChevronDown, ChevronUp, Info
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
type TimeSlotKey = 'morning' | 'afternoon' | 'evening' | 'night'
type SectionKey = 'profile' | 'alerts'

interface PushDevice {
  endpoint: string
  current_device: boolean
}

interface NotifSettings {
  telegram_linked: boolean
  push_enabled: boolean
  push_enabled_current_device: boolean
  push_device_count: number
  push_devices: PushDevice[]
  slots: TimeSlotKey[]
  times: Record<TimeSlotKey, string>
  timezone_name: string | null
}

const ALL_SLOTS: { key: TimeSlotKey; label: string; emoji: string }[] = [
  { key: 'morning',   label: 'Morning',   emoji: '🌅' },
  { key: 'afternoon', label: 'Afternoon', emoji: '☀️' },
  { key: 'evening',   label: 'Evening',   emoji: '🌆' },
  { key: 'night',     label: 'Night',     emoji: '🌙' },
]

function buildTimezoneOptions(): { value: string; label: string }[] {
  const now = new Date()
  try {
    const names: string[] = Intl.supportedValuesOf('timeZone')
    return names.map((tz) => {
      const formatter = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      const offset = formatter.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || ''
      return { value: tz, label: `${tz} (${offset})` }
    })
  } catch {
    return [{ value: 'UTC', label: 'UTC (GMT+0:00)' }]
  }
}

const TIMEZONES = buildTimezoneOptions()

// ── Helpers ───────────────────────────────────────────────────────────────────
async function urlBase64ToUint8Array(base64String: string): Promise<Uint8Array> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export default function SettingsDashboard() {
  const { user, logout, activeMemberId } = useAuth()

  // Unified loading and fetch status
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Sections toggle — both open by default (product settings, not ops health)
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    profile: true,
    alerts: true,
  })

  // 1. Notification & Timezone State
  const [settings, setSettings] = useState<NotifSettings | null>(null)
  const [pushLoading, setPushLoading] = useState(false)
  const [testLoading, setTestLoading] = useState(false)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const [subReady, setSubReady] = useState(false)

  // Timezone dynamic clock preview
  const [selectedTz, setSelectedTz] = useState('Asia/Kolkata')
  const timezoneOptions = TIMEZONES
  const [tzPreviewTime, setTzPreviewTime] = useState('')

  // Telegram states
  const [tgModal, setTgModal] = useState(false)
  const [tgCode, setTgCode] = useState('')
  const [tgBotUsername, setTgBotUsername] = useState('DawaiSathiBot')
  const [tgPolling, setTgPolling] = useState(false)
  const [tgCopied, setTgCopied] = useState(false)
  const [tgLinked, setTgLinked] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  // Time slots states
  const [editTimes, setEditTimes] = useState<Record<TimeSlotKey, string>>({
    morning: '08:00', afternoon: '13:00', evening: '18:00', night: '22:00',
  })
  const [activeSlots, setActiveSlots] = useState<TimeSlotKey[]>([])
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // ── Load & Synchronize data on mount ─────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const reg = await navigator.serviceWorker.getRegistration()
          if (reg) {
            const sub = await reg.pushManager.getSubscription()
            setCurrentEndpoint(sub ? sub.endpoint : null)
          }
        } catch (err) {
          if (import.meta.env.DEV) console.warn('[Dashboard] SW registration query failed:', err)
        }
      }
      setSubReady(true)
    })()
  }, [])

  const fetchData = useCallback(async () => {
    if (!subReady) return
    try {
      const url = currentEndpoint
        ? `/notifications/settings?endpoint=${encodeURIComponent(currentEndpoint)}`
        : '/notifications/settings'

      const settingsRes = await api.get(url)
      const sData = settingsRes.data
      setSettings(sData)
      setEditTimes(sData.times || { morning: '08:00', afternoon: '13:00', evening: '18:00', night: '22:00' })
      setActiveSlots(sData.slots || [])
      setSelectedTz(sData.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')

    } catch (err) {
      if (import.meta.env.DEV) console.error('[Dashboard] Failed to fetch settings:', err)
      showToast('Failed to load settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [currentEndpoint, subReady])

  useEffect(() => {
    fetchData()
  }, [user, fetchData])

  // Timezone preview clock updater
  useEffect(() => {
    const updateTime = () => {
      const options: Intl.DateTimeFormatOptions = {
        timeStyle: 'short',
        timeZone: selectedTz,
      }
      try {
        const timeStr = new Intl.DateTimeFormat('en-US', options).format(new Date())
        setTzPreviewTime(timeStr)
      } catch {
        setTzPreviewTime(new Date().toLocaleTimeString())
      }
    }
    updateTime()
    const timer = setInterval(updateTime, 30000)
    return () => clearInterval(timer)
  }, [selectedTz])

  // ── Timezone & Reminders Slots Mutation ──────────────────────────────────────────
  const handleSlotToggle = (slot: TimeSlotKey) => {
    setActiveSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
    )
    setSettingsDirty(true)
  }

  const handleTimeChange = (slot: TimeSlotKey, value: string) => {
    setEditTimes((prev) => ({ ...prev, [slot]: value }))
    setSettingsDirty(true)
  }

  const handleTzChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTz(e.target.value)
    setSettingsDirty(true)
  }

  const handleSaveSettings = async () => {
    setSettingsSaving(true)
    try {
      await api.post('/notifications/settings', {
        slots: activeSlots,
        times: editTimes,
        timezone_name: selectedTz,
      })
      
      // Update local settings state reference
      if (settings) {
        setSettings({
          ...settings,
          slots: activeSlots,
          times: editTimes,
          timezone_name: selectedTz,
        })
      }
      setSettingsDirty(false)
      showToast('✓ Preferences saved successfully', 'success')
    } catch {
      showToast('Failed to save preferences', 'error')
    } finally {
      setSettingsSaving(false)
    }
  }

  // ── Telegram Linking polling flows ────────────────────────────────────────────
  const startPolling = (code: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollCountRef.current = 0
    setTgPolling(true)

    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current > 60) { // Timeout after 5 minutes (60 * 5s)
        stopPolling()
        showToast('Linking code expired. Please generate a new one.', 'error')
        return
      }
      try {
        const res = await api.get(`/notifications/telegram/status?code=${code}`)
        if (res.data.linked) {
          stopPolling()
          setTgLinked(true)
          if (settings) setSettings({ ...settings, telegram_linked: true })
          showToast('✓ Telegram linked successfully!', 'success')
        }
      } catch {
        stopPolling()
        showToast('Telegram link check failed', 'error')
      }
    }, 5000)
  }

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setTgPolling(false)
  }

  const handleGenerateTelegramCode = async () => {
    try {
      const res = await api.get('/notifications/telegram/code')
      setTgCode(res.data.code)
      if (res.data.bot_username) setTgBotUsername(res.data.bot_username)
      setTgLinked(false)
      setTgCopied(false)
      setTgModal(true)
      startPolling(res.data.code)
    } catch {
      showToast('Failed to generate code', 'error')
    }
  }

  const handleUnlinkTelegram = async () => {
    if (!window.confirm('Are you sure you want to unlink Telegram notifications?')) return
    try {
      await api.post('/notifications/telegram/unlink')
      if (settings) setSettings({ ...settings, telegram_linked: false })
      showToast('✓ Telegram unlinked successfully', 'success')
    } catch {
      showToast('Failed to unlink Telegram', 'error')
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(tgCode)
    setTgCopied(true)
    setTimeout(() => setTgCopied(false), 2000)
  }

  // ── Web Push Flow ────────────────────────────────────────────────────────────
  const handleTogglePush = async () => {
    if (pushLoading) return
    setPushLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const isEnabled = settings?.push_enabled_current_device

      if (isEnabled) {
        // Disable on current device
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await subscription.unsubscribe()
          await api.post('/notifications/push/unsubscribe', { endpoint: subscription.endpoint })
        }
        showToast('Push alerts disabled on this device', 'success')
      } else {
        // Enable on current device
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          showToast('Notification permission denied', 'error')
          setPushLoading(false)
          return
        }

        const vapidRes = await api.get('/notifications/push/vapid-key')
        const convertedKey = await urlBase64ToUint8Array(vapidRes.data.public_key)

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey as any,
        })

        await api.post('/notifications/push/subscribe', { subscription: subscription.toJSON ? subscription.toJSON() : subscription })
        setCurrentEndpoint(subscription.endpoint)
        showToast('✓ Push alerts enabled on this device', 'success')
      }
      // Reload setting state variables
      await fetchData()
    } catch (err: any) {
      showToast(err.message || 'Push registration failed', 'error')
    } finally {
      setPushLoading(false)
    }
  }

  const handleSendTestPush = async () => {
    if (testLoading) return
    setTestLoading(true)
    try {
      if (!currentEndpoint) { showToast('No push subscription found', 'error'); setTestLoading(false); return }
      await api.post('/notifications/push/test', { endpoint: currentEndpoint })
      showToast('✓ Test alert sent!', 'success')
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to send test push', 'error')
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <>
      <AppLayout familyMembers={[]} activeMemberId={activeMemberId} onSelectMember={() => {}}>
        {loading ? (
          <div className="loading-overlay">
            <div className="loading-spinner" />
          </div>
        ) : (
          <div className="settings-dashboard-container" style={{ padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* TOAST SYSTEM */}
            {toast && (
              <div className={`toast-message ${toast.type}`} style={{
                position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
                background: toast.type === 'success' ? '#10b981' : '#ef4444', color: 'white',
                padding: '10px 20px', borderRadius: 50, zIndex: 1000, fontSize: '0.85rem', fontWeight: 600,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', whiteSpace: 'nowrap'
              }}>
                {toast.msg}
              </div>
            )}

            {/* ── SECTION 1: PROFILE ACCORDION ────────────────────────────────── */}
            <div className="accordion-card card">
              <button 
                className="accordion-header" 
                onClick={() => toggleSection('profile')}
                style={{ width: '100%', border: 'none', background: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', outline: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="avatar-small" style={{
                    width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-teal-glow)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-teal)',
                    fontSize: '0.9rem', fontWeight: 700, border: '1px solid var(--accent-teal)'
                  }}>
                    {user?.name.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>Profile & Account</span>
                </div>
                {openSections.profile ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </button>

              {openSections.profile && (
                <div className="accordion-content" style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{user?.email}</div>
                  </div>
                  <button 
                    onClick={logout} 
                    className="btn-danger-subtle" 
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10,
                      background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)',
                      fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    <LogOut size={13} />
                    Logout
                  </button>
                </div>
              )}
            </div>

            {/* ── SECTION 2: ALERTS & TIMINGS ACCORDION ───────────────────────── */}
            <div className="accordion-card card">
              <button 
                className="accordion-header" 
                onClick={() => toggleSection('alerts')}
                style={{ width: '100%', border: 'none', background: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', outline: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Bell size={18} color="var(--accent-teal)" />
                  <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>Reminder Preferences</span>
                </div>
                {openSections.alerts ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </button>

              {openSections.alerts && (
                <div className="accordion-content" style={{ marginTop: 20 }}>
                  
                  {/* Timezone Preference */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      Explicit Timezone Lock
                    </label>
                    <select 
                      value={selectedTz} 
                      onChange={handleTzChange}
                      style={{
                        width: '100%', padding: '12px', borderRadius: 12, background: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none',
                        fontSize: '0.85rem', fontWeight: 500
                      }}
                    >
                      {timezoneOptions.map((tz) => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>

                    <div className="info-box-styled" style={{
                      display: 'flex', gap: 8, marginTop: 10, padding: 12, borderRadius: 10,
                      background: 'var(--accent-teal-glow)', border: '1px dashed var(--border-glow)',
                      fontSize: '0.78rem', color: 'var(--accent-teal-dark)', lineHeight: 1.5
                    }}>
                      <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        Schedules will trigger using <strong>{selectedTz}</strong> timezone. Current time in this zone is <strong>{tzPreviewTime}</strong>.
                      </span>
                    </div>
                  </div>

                  <div style={{ height: 1, background: 'var(--border-subtle)', margin: '16px 0' }} />

                  {/* Slot Times Config */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12 }}>
                      Reminder Slots & Times
                    </label>
                    
                    {ALL_SLOTS.map((slot) => {
                      const isChecked = activeSlots.includes(slot.key)
                      return (
                        <div key={slot.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--bg-primary)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={() => handleSlotToggle(slot.key)}
                              style={{ width: 16, height: 16, accentColor: 'var(--accent-teal)' }}
                            />
                            <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{slot.emoji} {slot.label}</span>
                          </div>
                          <input 
                            type="time" 
                            value={editTimes[slot.key] || '08:00'}
                            onChange={(e) => handleTimeChange(slot.key, e.target.value)}
                            style={{
                              width: 90, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-primary)',
                              border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
                              fontSize: '0.82rem', textAlign: 'center'
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>

                  {/* Save floats */}
                  {settingsDirty && (
                    <button 
                      onClick={handleSaveSettings}
                      disabled={settingsSaving}
                      className="btn-primary" 
                      style={{ width: '100%', padding: 12, borderRadius: 12, fontSize: '0.85rem', fontWeight: 700, marginBottom: 20 }}
                    >
                      {settingsSaving ? 'Saving...' : '✓ Save Reminder Slots & Times'}
                    </button>
                  )}

                  <div style={{ height: 1, background: 'var(--border-subtle)', margin: '16px 0' }} />

                  {/* Push Notifications Section */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Web Push Alerts</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Get alerts directly on your browser screen</div>
                      </div>
                      <button 
                        onClick={handleTogglePush}
                        disabled={pushLoading}
                        className={settings?.push_enabled_current_device ? 'btn-ghost' : 'btn-primary'}
                        style={{ padding: '8px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        {pushLoading ? '...' : settings?.push_enabled_current_device ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                    {settings?.push_enabled_current_device && (
                      <button 
                        onClick={handleSendTestPush}
                        disabled={testLoading}
                        className="btn-ghost"
                        style={{ width: '100%', marginTop: 8, padding: 8, fontSize: '0.78rem', color: 'var(--accent-teal)' }}
                      >
                        {testLoading ? 'Sending...' : 'Send Test Notification to current device'}
                      </button>
                    )}
                  </div>

                  {/* Telegram Section */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Telegram Bot Alerts</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Receive reminders on your Telegram account</div>
                      </div>
                      <button 
                        onClick={settings?.telegram_linked ? handleUnlinkTelegram : handleGenerateTelegramCode}
                        className={settings?.telegram_linked ? 'btn-ghost' : 'btn-primary'}
                        style={{ padding: '8px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        {settings?.telegram_linked ? 'Unlink' : 'Link Bot'}
                      </button>
                    </div>
                  </div>

                </div>
              )}
            </div>

          </div>
        )}
      </AppLayout>

      {/* ── Telegram Linking Modal ── */}
      {tgModal && (
        <div className="modal-overlay modal-overlay-center" onClick={() => { stopPolling(); setTgModal(false); setTgLinked(false) }}>
          <div className="tg-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="tg-logo-circle">
              <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.26-1.911.177-.183 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
            </div>
            <h2 className="tg-title">Link Telegram</h2>
            <p className="tg-subtitle">Send this code to <a href={`https://t.me/${tgBotUsername}`} target="_blank" rel="noopener noreferrer">@{tgBotUsername}</a></p>
            <div className="tg-code-box">
              {tgCode.split('').map((digit, i) => (
                <span key={i} className={`tg-code-digit ${tgCopied || tgLinked ? 'filled' : ''}`}>{digit}</span>
              ))}
            </div>
            <div className="tg-action-row">
              <button className={`tg-btn tg-btn-copy ${tgCopied ? 'copied' : ''}`} onClick={handleCopyCode} type="button">
                {tgCopied ? '✓' : '📋'} {tgCopied ? 'Copied!' : 'Copy Code'}
              </button>
              <a className="tg-btn tg-btn-telegram" href={`https://t.me/${tgBotUsername}`} target="_blank" rel="noopener noreferrer">Open Telegram</a>
            </div>
            {tgPolling && !tgLinked && (
              <div className="tg-waiting" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
                <RefreshCw size={12} className="spin" /> Waiting for bot code message... ({Math.max(0, 300 - pollCountRef.current * 5)}s remaining)
              </div>
            )}
            {tgLinked && (
              <div className="tg-success-overlay">
                <div className="tg-success-check">✓</div>
                <div className="tg-success-text">Linked! 🎉</div>
              </div>
            )}
            {!tgLinked && (
              <button className="tg-cancel-btn" onClick={() => { stopPolling(); setTgModal(false); setTgLinked(false) }} type="button">✕ Cancel</button>
            )}
          </div>
        </div>
      )}

    </>
  )
}
