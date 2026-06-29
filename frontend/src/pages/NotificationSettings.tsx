import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Bell, BellOff, MessageCircle, Clock,
  Check, X, RefreshCw, Send, Unlink, Link, Loader2
} from 'lucide-react'
import api from '../api/client'
import Header from '../components/Header'

// ── Types ─────────────────────────────────────────────────────────────────────
type TimeSlotKey = 'morning' | 'afternoon' | 'evening' | 'night'

interface NotifSettings {
  telegram_linked: boolean
  push_enabled: boolean
  slots: TimeSlotKey[]
  times: Record<TimeSlotKey, string>
}

const ALL_SLOTS: { key: TimeSlotKey; label: string; emoji: string }[] = [
  { key: 'morning',   label: 'Morning',   emoji: '🌅' },
  { key: 'afternoon', label: 'Afternoon', emoji: '☀️' },
  { key: 'evening',   label: 'Evening',   emoji: '🌆' },
  { key: 'night',     label: 'Night',     emoji: '🌙' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
async function urlBase64ToUint8Array(base64String: string): Promise<Uint8Array> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function NotificationSettings() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<NotifSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [pushLoading, setPushLoading] = useState(false)
  const [testLoading, setTestLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Telegram linking state
  const [tgModal, setTgModal] = useState(false)
  const [tgCode, setTgCode] = useState('')
  const [tgBotUsername, setTgBotUsername] = useState('DawaiSathiBot')
  const [tgPolling, setTgPolling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  // Times being edited locally before save
  const [editTimes, setEditTimes] = useState<Record<TimeSlotKey, string>>({
    morning: '08:00', afternoon: '13:00', evening: '18:00', night: '22:00',
  })
  const [timeDirty, setTimeDirty] = useState(false)
  const [timeSaving, setTimeSaving] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Load settings ───────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/notifications/settings')
      .then((r) => {
        setSettings(r.data)
        setEditTimes({ ...{ morning: '08:00', afternoon: '13:00', evening: '18:00', night: '22:00' }, ...r.data.times })
      })
      .catch(() => showToast('Could not load notification settings', 'error'))
      .finally(() => setLoading(false))
  }, [])

  // ── Toggle a slot on/off ────────────────────────────────────────────────────
  const toggleSlot = async (key: TimeSlotKey) => {
    if (!settings) return
    const current = settings.slots
    const next = current.includes(key)
      ? current.filter((s) => s !== key)
      : [...current, key]
    try {
      await api.post('/notifications/settings', { slots: next })
      setSettings({ ...settings, slots: next })
    } catch {
      showToast('Could not save slot preference', 'error')
    }
  }

  // ── Save custom times ───────────────────────────────────────────────────────
  const saveTimes = async () => {
    setTimeSaving(true)
    try {
      await api.post('/notifications/settings', { times: editTimes })
      setSettings((s) => s ? { ...s, times: editTimes } : s)
      setTimeDirty(false)
      showToast('Reminder times saved ✓')
    } catch {
      showToast('Could not save times', 'error')
    } finally {
      setTimeSaving(false)
    }
  }

  // ── Web Push ────────────────────────────────────────────────────────────────
  const enablePush = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      showToast('Push notifications are not supported in this browser', 'error')
      return
    }
    setPushLoading(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        showToast('Permission denied — please allow notifications in browser settings', 'error')
        return
      }

      // Fetch VAPID public key
      const keyRes = await api.get('/notifications/push/vapid-key')
      const vapidKey: string = keyRes.data.public_key
      if (!vapidKey) {
        showToast('Push is not configured yet (missing VAPID key)', 'error')
        return
      }

      const sw = await navigator.serviceWorker.ready
      const sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await urlBase64ToUint8Array(vapidKey),
      })

      await api.post('/notifications/push/subscribe', { subscription: sub.toJSON() })
      setSettings((s) => s ? { ...s, push_enabled: true } : s)
      showToast('Phone notifications enabled ✓')
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : 'Failed to enable push notifications',
        'error',
      )
    } finally {
      setPushLoading(false)
    }
  }

  const disablePush = async () => {
    setPushLoading(true)
    try {
      const sw = await navigator.serviceWorker.ready
      const sub = await sw.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
      await api.post('/notifications/push/unsubscribe')
      setSettings((s) => s ? { ...s, push_enabled: false } : s)
      showToast('Phone notifications disabled')
    } catch {
      showToast('Could not disable push notifications', 'error')
    } finally {
      setPushLoading(false)
    }
  }

  const sendTestPush = async () => {
    setTestLoading(true)
    try {
      await api.post('/notifications/push/test')
      showToast('Test notification sent — check your phone! 🔔')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      showToast(msg || 'Test failed', 'error')
    } finally {
      setTestLoading(false)
    }
  }

  // ── Telegram linking ────────────────────────────────────────────────────────
  const openTelegramModal = async () => {
    try {
      const res = await api.get('/notifications/telegram/code')
      setTgCode(res.data.code)
      setTgBotUsername(res.data.bot_username)
      setTgModal(true)
      startPolling()
    } catch {
      showToast('Could not generate link code', 'error')
    }
  }

  const startPolling = () => {
    setTgPolling(true)
    pollCountRef.current = 0
    if (pollRef.current) clearInterval(pollRef.current)

    pollRef.current = setInterval(async () => {
      pollCountRef.current++
      if (pollCountRef.current > 60) {   // 3-minute timeout (60 × 3s)
        stopPolling()
        return
      }
      try {
        const res = await api.get('/notifications/telegram/status')
        if (res.data.linked) {
          stopPolling()
          setTgModal(false)
          setSettings((s) => s ? { ...s, telegram_linked: true } : s)
          showToast('Telegram linked successfully! ✓')
        }
      } catch {
        // ignore transient errors during polling
      }
    }, 3000)
  }

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setTgPolling(false)
  }

  const unlinkTelegram = async () => {
    try {
      await api.post('/notifications/telegram/unlink')
      setSettings((s) => s ? { ...s, telegram_linked: false } : s)
      showToast('Telegram unlinked')
    } catch {
      showToast('Could not unlink Telegram', 'error')
    }
  }

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), [])

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="app-shell">
        <Header />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-teal)' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Header />

      {/* Toast */}
      {toast && (
        <div className={`notif-toast ${toast.type}`} role="alert">
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />}
          {toast.msg}
        </div>
      )}

      <div className="page-scroll" style={{ padding: '16px 16px 40px' }}>

        {/* Page title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <button
            className="icon-btn"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            type="button"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
              Notifications
            </h1>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Medicine reminders for you
            </p>
          </div>
        </div>

        {/* ── Section 1: Phone Notifications ─────────────────────────────── */}
        <div className="notif-card">
          <div className="notif-card-header">
            <div className="notif-card-icon" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Bell size={18} color="white" />
            </div>
            <div>
              <div className="notif-card-title">Phone Notifications</div>
              <div className="notif-card-sub">
                {settings?.push_enabled ? '✅ Active — shows on lock screen' : 'Shows as a phone popup'}
              </div>
            </div>
            <div className="notif-status-pill" data-enabled={settings?.push_enabled}>
              {settings?.push_enabled ? 'On' : 'Off'}
            </div>
          </div>

          <div className="notif-card-actions">
            {settings?.push_enabled ? (
              <>
                <button
                  className="notif-btn notif-btn-ghost"
                  onClick={sendTestPush}
                  disabled={testLoading}
                  type="button"
                  id="notif-test-push-btn"
                >
                  {testLoading
                    ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Send size={14} />}
                  Send Test
                </button>
                <button
                  className="notif-btn notif-btn-danger"
                  onClick={disablePush}
                  disabled={pushLoading}
                  type="button"
                  id="notif-disable-push-btn"
                >
                  <BellOff size={14} />
                  Disable
                </button>
              </>
            ) : (
              <button
                className="notif-btn notif-btn-primary"
                onClick={enablePush}
                disabled={pushLoading}
                type="button"
                id="notif-enable-push-btn"
                style={{ width: '100%' }}
              >
                {pushLoading
                  ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Bell size={14} />}
                {pushLoading ? 'Requesting permission…' : 'Enable Phone Notifications'}
              </button>
            )}
          </div>
        </div>

        {/* ── Section 2: Telegram ─────────────────────────────────────────── */}
        <div className="notif-card">
          <div className="notif-card-header">
            <div className="notif-card-icon" style={{ background: 'linear-gradient(135deg, #0088cc, #00a9e0)' }}>
              <MessageCircle size={18} color="white" />
            </div>
            <div>
              <div className="notif-card-title">Telegram</div>
              <div className="notif-card-sub">
                {settings?.telegram_linked
                  ? '✅ Bot linked — DMs on reminder time'
                  : 'Receive DMs from @' + tgBotUsername}
              </div>
            </div>
            <div className="notif-status-pill" data-enabled={settings?.telegram_linked}>
              {settings?.telegram_linked ? 'On' : 'Off'}
            </div>
          </div>

          <div className="notif-card-actions">
            {settings?.telegram_linked ? (
              <button
                className="notif-btn notif-btn-danger"
                onClick={unlinkTelegram}
                type="button"
                id="notif-unlink-telegram-btn"
              >
                <Unlink size={14} />
                Unlink Telegram
              </button>
            ) : (
              <button
                className="notif-btn notif-btn-telegram"
                onClick={openTelegramModal}
                type="button"
                id="notif-link-telegram-btn"
                style={{ width: '100%' }}
              >
                <Link size={14} />
                Link Telegram
              </button>
            )}
          </div>
        </div>

        {/* ── Section 3: Reminder Schedule ───────────────────────────────── */}
        <div className="notif-card" style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 16 }}>
            <div className="notif-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={15} style={{ color: 'var(--accent-teal)' }} />
              Reminder Times
            </div>
            <div className="notif-card-sub" style={{ marginTop: 2 }}>
              Set when each dose reminder fires. Toggle to enable/disable.
            </div>
          </div>

          {ALL_SLOTS.map(({ key, label, emoji }) => {
            const active = settings?.slots.includes(key) ?? true
            return (
              <div key={key} className={`notif-slot-row ${active ? 'active' : 'inactive'}`}>
                <button
                  className={`slot-toggle ${active ? 'on' : 'off'}`}
                  onClick={() => toggleSlot(key)}
                  type="button"
                  aria-label={`Toggle ${label} reminder`}
                  aria-pressed={active}
                  id={`notif-slot-${key}`}
                >
                  <span className="slot-toggle-thumb" />
                </button>
                <span className="slot-emoji">{emoji}</span>
                <span className="slot-label">{label}</span>
                <input
                  type="time"
                  className="slot-time-input"
                  value={editTimes[key] ?? '08:00'}
                  disabled={!active}
                  onChange={(e) => {
                    setEditTimes((prev) => ({ ...prev, [key]: e.target.value }))
                    setTimeDirty(true)
                  }}
                  aria-label={`${label} reminder time`}
                  id={`notif-time-${key}`}
                />
              </div>
            )
          })}

          {timeDirty && (
            <button
              className="notif-btn notif-btn-primary"
              onClick={saveTimes}
              disabled={timeSaving}
              type="button"
              id="notif-save-times-btn"
              style={{ width: '100%', marginTop: 14 }}
            >
              {timeSaving
                ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                : <Check size={14} />}
              {timeSaving ? 'Saving…' : 'Save Reminder Times'}
            </button>
          )}
        </div>

        {/* ── Explainer ──────────────────────────────────────────────────── */}
        <div className="notif-explainer">
          <strong>How it works:</strong> At each reminder time, DawaiSathi checks your active medicines.
          If any are due (and still within their prescribed days), you get a notification —
          even if your phone is locked. The <em>days</em> field from your prescriptions is used
          to automatically stop reminders when a course ends.
        </div>
      </div>

      {/* ── Telegram Linking Modal ──────────────────────────────────────────── */}
      {tgModal && (
        <div className="modal-overlay" onClick={() => { stopPolling(); setTgModal(false) }}>
          <div className="modal-box tg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tg-modal-icon">✈️</div>
            <h2 className="tg-modal-title">Link Telegram</h2>
            <p className="tg-modal-desc">
              Open Telegram and send this code to{' '}
              <a
                href={`https://t.me/${tgBotUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-teal)', fontWeight: 600 }}
              >
                @{tgBotUsername}
              </a>
            </p>

            <div className="tg-code-box">
              {tgCode.split('').map((digit, i) => (
                <span key={i} className="tg-code-digit">{digit}</span>
              ))}
            </div>

            {tgPolling && (
              <div className="tg-waiting">
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Waiting for you to send the code…
              </div>
            )}

            <p className="tg-modal-desc" style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Code expires in 10 minutes
            </p>

            <button
              className="notif-btn notif-btn-ghost"
              onClick={() => { stopPolling(); setTgModal(false) }}
              type="button"
              style={{ width: '100%', marginTop: 8 }}
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
