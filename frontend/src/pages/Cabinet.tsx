import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import AppLayout from '../components/AppLayout'
import ConfirmDialog from '../components/ConfirmDialog'
import SkeletonRow from '../components/SkeletonRow'
import Toast from '../components/Toast'
import EmptyState from '../components/EmptyState'
import EditMedicineModal from '../components/EditMedicineModal'
import InteractionCheckerCard from '../components/InteractionCheckerCard'
import api, { getImageUrl } from '../api/client'
import type { User, MedicineEntry, TimeSlot } from '../types'
import { Pill, Archive, X, Trash2, Pencil, Clock } from 'lucide-react'

const TIME_SLOTS: { key: TimeSlot; label: string; time: string }[] = [
  { key: 'morning', label: 'Morning', time: '8:00 AM' },
  { key: 'afternoon', label: 'Afternoon', time: '1:00 PM' },
  { key: 'evening', label: 'Evening', time: '6:00 PM' },
  { key: 'night', label: 'Night', time: '10:00 PM' },
]

// Default slot times in 24h "HH:MM" format — mirrors backend defaults
const DEFAULT_SLOT_TIMES: Record<TimeSlot, string> = {
  morning: '08:00',
  afternoon: '13:00',
  evening: '18:00',
  night: '22:00',
}

// Minutes before the scheduled slot time when logging becomes available
const LOGGING_WINDOW_MINUTES = 60

type LoggingState = 'dormant' | 'active' | 'logged'

/**
 * Returns the logging state for a medicine dose.
 * - 'logged'  : dose already taken today
 * - 'active'  : within the logging window (up to LOGGING_WINDOW_MINUTES before slot)
 * - 'dormant' : too early — window hasn't opened yet
 */
function getLoggingState(slotTime: string, isLogged: boolean): LoggingState {
  if (isLogged) return 'logged'

  const now = new Date()
  const [hStr, mStr] = slotTime.split(':')
  const slotDate = new Date()
  slotDate.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0)

  // Window opens LOGGING_WINDOW_MINUTES before the scheduled dose time
  const windowOpenMs = slotDate.getTime() - LOGGING_WINDOW_MINUTES * 60 * 1000
  return now.getTime() >= windowOpenMs ? 'active' : 'dormant'
}

/** Formats "HH:MM" → "8:00 AM" / "1:00 PM" style */
function formatSlotTime(slotTime: string): string {
  const [hStr, mStr] = slotTime.split(':')
  const hour = parseInt(hStr, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${mStr} ${ampm}`
}

interface MedCardProps {
  med: MedicineEntry
  slot: TimeSlot
  /** Resolved slot time in "HH:MM" 24h format, factoring in user's custom times */
  slotTime: string
  onLog: (entryId: number, slot: TimeSlot) => Promise<void>
  onImageClick: (url: string) => void
  onDelete: (entryId: number, slot: TimeSlot) => void
  onEdit: (med: MedicineEntry) => void
}

import { motion, AnimatePresence } from 'framer-motion'

const cardVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { 
    opacity: 1, 
    y: 0, 
    transition: { type: 'spring' as const, stiffness: 280, damping: 23 } 
  },
  exit: { 
    opacity: 0, 
    scale: 0.95, 
    y: -8,
    transition: { duration: 0.18 } 
  }
}

function MedicineCard({ med, slot, slotTime, onLog, onImageClick, onDelete, onEdit }: MedCardProps) {
  const isLogged = med.today_logs?.includes(slot) ?? false
  const [loggingState, setLoggingState] = useState<LoggingState>(
    () => getLoggingState(slotTime, isLogged)
  )
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Re-evaluate the logging window every 30 seconds so the card updates
  // automatically when the window opens (e.g., at 12:00 for the 1pm dose)
  useEffect(() => {
    const tick = () => setLoggingState(getLoggingState(slotTime, isLogged))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [slotTime, isLogged])

  const isDormant = loggingState === 'dormant'

  const startHold = () => {
    if (loggingState !== 'active') return
    setHolding(true)
    setProgress(0)
    let p = 0
    progressTimer.current = setInterval(() => {
      p += 10
      setProgress(p)
      if (p >= 100) {
        clearInterval(progressTimer.current!)
      }
    }, 40)
    holdTimer.current = setTimeout(() => {
      onLog(med.id, slot)
      setHolding(false)
      setProgress(0)
    }, 400)
  }

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    if (progressTimer.current) clearInterval(progressTimer.current)
    setHolding(false)
    setProgress(0)
  }

  const handleThumbClick = () => {
    if (med.pack_image_url) {
      onImageClick(getImageUrl(med.pack_image_url))
    }
  }

  // Build hold-log-bar label based on state
  let barLabel: React.ReactNode
  if (loggingState === 'logged') {
    barLabel = '✓ Dose logged'
  } else if (loggingState === 'dormant') {
    barLabel = (
      <>
        <Clock size={13} style={{ marginRight: 6, opacity: 0.7 }} aria-hidden="true" />
        Available at {formatSlotTime(slotTime)}
      </>
    )
  } else {
    barLabel = 'Hold to log dose'
  }

  return (
    <motion.div
      layout
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={`medicine-card-v2 ${slot}${isDormant ? ' dormant-card' : ''}${loggingState === 'logged' ? ' logged-card' : ''}`}
    >
      {/* Top Section */}
      <div className="card-top">
        <div
          className="card-thumb"
          onClick={handleThumbClick}
          style={{ cursor: med.pack_image_url ? 'pointer' : 'default' }}
        >
          {med.pack_image_url ? (
            <img
              src={getImageUrl(med.pack_image_url)}
              alt={med.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
            />
          ) : (
            <Pill size={22} color={isDormant ? 'var(--text-muted)' : 'var(--text-muted)'} />
          )}
        </div>

        <div className="card-info">
          <div className="med-name">
            {med.name}
            {med.scan_image_url && (
              <button
                className="view-rx-badge"
                onClick={() => onImageClick(med.scan_image_url || '')}
                title="View original prescription reference"
                type="button"
              >
                Rx
              </button>
            )}
          </div>

          <div className="med-meta">
            {med.dosage && <span>Dosage: {med.dosage}</span>}
            {med.dosage && med.days != null && <span className="meta-dot"></span>}
            {med.days != null && <span>Duration: {med.days} days</span>}
          </div>

          {med.instructions && (
            <div className="med-instructions">{med.instructions}</div>
          )}
        </div>

        {/* Absolute Corner Actions */}
        <div className="card-actions-corner">
          <button
            className="action-btn-circle"
            onClick={() => onEdit(med)}
            aria-label="Edit medicine"
            type="button"
          >
            <Pencil size={14} />
          </button>

          <button
            className="action-btn-circle delete"
            onClick={() => onDelete(med.id, slot)}
            aria-label="Delete medicine"
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="card-bottom">
        <motion.button
          whileTap={isDormant || loggingState === 'logged' ? undefined : { scale: 0.97 }}
          className={`hold-log-bar ${loggingState}`}
          onMouseDown={isDormant || loggingState === 'logged' ? undefined : startHold}
          onMouseUp={isDormant || loggingState === 'logged' ? undefined : cancelHold}
          onMouseLeave={isDormant || loggingState === 'logged' ? undefined : cancelHold}
          onTouchStart={isDormant || loggingState === 'logged' ? undefined : startHold}
          onTouchEnd={isDormant || loggingState === 'logged' ? undefined : cancelHold}
          style={
            holding && loggingState === 'active'
              ? {
                  background: `linear-gradient(to right, var(--logged-color) ${progress}%, #dc2626 ${progress}%)`,
                  color: 'white',
                }
              : undefined
          }
          disabled={isDormant}
          aria-label={
            loggingState === 'logged'
              ? 'Dose already logged'
              : loggingState === 'dormant'
              ? `Not available yet. Opens at ${formatSlotTime(slotTime)}`
              : 'Hold to log dose'
          }
          id={`log-btn-${med.id}-${slot}`}
          type="button"
        >
          {barLabel}
        </motion.button>
      </div>
    </motion.div>
  )
}

export default function Cabinet() {
  const { user, activeMemberId, setActiveMemberId } = useAuth()
  const [members, setMembers] = useState<User[]>([])
  const [medicines, setMedicines] = useState<MedicineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [activeLightboxImage, setActiveLightboxImage] = useState<string | null>(null)
  const [editingMed, setEditingMed] = useState<MedicineEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ entryId: number; slot: TimeSlot; name: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const hasFetchedOnce = useRef(false)
  const [customTimes, setCustomTimes] = useState<Record<string, string>>({})

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const fetchCabinet = useCallback(async (userId: number, isBackground = false) => {
    if (!isBackground) {
      if (!hasFetchedOnce.current) {
        setLoading(true)
      } else {
        setIsFetching(true)
      }
    }
    try {
      const tzOffset = new Date().getTimezoneOffset()
      const localDate = new Date().toLocaleDateString('sv-SE')
      const res = await api.get(
        `/medicine/cabinet?user_id=${userId}&tz_offset=${tzOffset}&local_date=${localDate}`
      )
      setMedicines(res.data.medicines || [])
      hasFetchedOnce.current = true

      // Sync active schedules to the Service Worker in the background
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        api.get('/notifications/settings').then((settingsRes) => {
          navigator.serviceWorker.controller?.postMessage({
            type: 'SYNC_SCHEDULES',
            payload: {
              slots: settingsRes.data.slots || [],
              times: settingsRes.data.times || {},
              medicines: res.data.medicines || [],
            }
          })
        }).catch((e) => { if (import.meta.env.DEV) console.warn('[Cabinet] SW sync failed:', e) })
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('[Cabinet] fetch error:', e)
      showToast('Failed to load cabinet')
    } finally {
      setLoading(false)
      setIsFetching(false)
    }
  }, [])

  // On mount: fetch everything in parallel for speed
  useEffect(() => {
    if (!user?.id) return
    const init = async () => {
      const [membersRes, settingsRes] = await Promise.allSettled([
        api.get('/family/members'),
        api.get('/notifications/settings'),
      ])
      if (membersRes.status === 'fulfilled') setMembers(membersRes.value.data.members || [])
      if (settingsRes.status === 'fulfilled') {
        setCustomTimes(settingsRes.value.data.times || {})
      }
    }
    init()
  }, [user])

  useEffect(() => {
    const id = activeMemberId || user?.id
    if (id) {
      fetchCabinet(id)
    }
  }, [activeMemberId, user?.id, fetchCabinet])

  const handleLog = async (entryId: number, slot: TimeSlot) => {
    try {
      await api.post('/medicine/log', { entry_id: entryId, time_slot: slot })
      showToast('✓ Dose logged!')
      setMedicines((prev) =>
        prev.map((m) =>
          m.id === entryId
            ? { ...m, today_logs: [...(m.today_logs || []), slot] }
            : m
        )
      )
    } catch {
      showToast('Failed to log dose')
    }
  }

  const requestDeleteMed = (entryId: number, slot: TimeSlot) => {
    const med = medicines.find((m) => m.id === entryId)
    if (!med) return
    setDeleteTarget({ entryId, slot, name: med.name })
  }

  const handleDeleteMed = async () => {
    if (!deleteTarget) return
    const { entryId, slot } = deleteTarget
    const med = medicines.find((m) => m.id === entryId)
    if (!med) return
    setDeleteBusy(true)
    const updatedSchedule = med.schedule.filter((s) => s !== slot)
    try {
      if (updatedSchedule.length === 0) {
        await api.delete(`/medicine/delete/${entryId}`)
        showToast('Medicine deleted')
        setMedicines((prev) => prev.filter((m) => m.id !== entryId))
      } else {
        const formData = new FormData()
        formData.append('schedule', JSON.stringify(updatedSchedule))
        const res = await api.post(`/medicine/update/${entryId}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        if (res.data.medicine) {
          setMedicines((prev) => prev.map((m) => (m.id === entryId ? res.data.medicine : m)))
          showToast(`Removed from ${slot}`)
        }
      }
      setDeleteTarget(null)
    } catch {
      showToast(updatedSchedule.length === 0 ? 'Failed to delete medicine' : 'Failed to remove schedule')
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleSelectMember = (id: number) => {
    setActiveMemberId(id)
  }

  const medicinesBySlot = (slot: TimeSlot) =>
    medicines.filter((m) => m.schedule.includes(slot))

  const hasMedicines = medicines.length > 0

  return (
    <>
      <AppLayout
        familyMembers={members}
        activeMemberId={activeMemberId}
        onSelectMember={handleSelectMember}
      >
        {loading ? (
          <SkeletonRow count={3} />
        ) : !hasMedicines ? (
          <EmptyState
            icon={<Archive size={48} color="var(--text-muted)" />}
            title="Cabinet is empty"
            description="Tap + to scan a prescription or add medicines"
          />
        ) : (
          <div style={{ paddingBottom: 16, opacity: isFetching ? 0.65 : 1, transition: 'opacity 0.2s ease' }}>
            {(() => {
              const totalDosesScheduled = medicines.reduce((acc, med) => acc + (med.schedule?.length || 0), 0)
              const totalDosesTaken = medicines.reduce(
                (acc, med) => acc + (med.today_logs ? med.today_logs.filter((s) => med.schedule.includes(s)).length : 0),
                0
              )
              const adherencePercent = totalDosesScheduled > 0 
                ? Math.round((totalDosesTaken / totalDosesScheduled) * 100)
                : 0

              return totalDosesScheduled > 0 ? (
                <div className="adherence-dashboard-card">
                  <div className="adherence-info">
                    <div className="adherence-text-sec">
                      <span className="adherence-score-title">Today&apos;s Adherence</span>
                      <span className="adherence-score-val">{adherencePercent}%</span>
                    </div>
                    <span className="adherence-fraction">
                      {totalDosesTaken} of {totalDosesScheduled} taken
                    </span>
                  </div>
                  <div className="adherence-progress-track">
                    <div 
                      className="adherence-progress-bar" 
                      style={{ width: `${adherencePercent}%` }} 
                    />
                  </div>
                </div>
              ) : null
            })()}

            <InteractionCheckerCard userId={activeMemberId} refreshTrigger={medicines.length} />

            <div className="cabinet-hero">
              <span className="cabinet-hero-title">Today&apos;s schedule</span>
              <span className="cabinet-hero-date">
                {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
            </div>
            {TIME_SLOTS.map(({ key, label, time }) => {
              const meds = medicinesBySlot(key)
              if (meds.length === 0) return null

              const customTime = customTimes[key]
              let timeDisplay = time
              if (customTime) {
                try {
                  const [hStr, mStr] = customTime.split(':')
                  const hour = parseInt(hStr, 10)
                  const ampm = hour >= 12 ? 'PM' : 'AM'
                  const displayHour = hour % 12 || 12
                  timeDisplay = `${displayHour}:${mStr} ${ampm}`
                } catch {
                  timeDisplay = customTime
                }
              }

              return (
                <div key={key}>
                  <div className={`time-band-header ${key}`}>
                    <span>
                      {label} · {timeDisplay}
                    </span>
                  </div>
                  <AnimatePresence initial={false}>
                    {meds.map((med) => (
                      <MedicineCard
                        key={med.id}
                        med={med}
                        slot={key}
                        slotTime={customTimes[key] || DEFAULT_SLOT_TIMES[key]}
                        onLog={handleLog}
                        onImageClick={setActiveLightboxImage}
                        onDelete={requestDeleteMed}
                        onEdit={setEditingMed}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </AppLayout>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
        onConfirm={handleDeleteMed}
        title="Remove this medicine?"
        description={
          deleteTarget
            ? `Remove “${deleteTarget.name}” from the ${deleteTarget.slot} schedule. If it has no other times, it will be deleted from the cabinet.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        busy={deleteBusy}
        titleId="delete-med-title"
      />

      {/* Image Lightbox Modal */}
      {activeLightboxImage && (
        <div className="lightbox-overlay" onClick={() => setActiveLightboxImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={getImageUrl(activeLightboxImage)} alt="Fullscreen Medicine" className="lightbox-image" />
            <button
              className="lightbox-close"
              onClick={() => setActiveLightboxImage(null)}
              aria-label="Close fullscreen view"
              type="button"
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Edit Medicine Modal */}
      {editingMed && (
        <EditMedicineModal
          med={editingMed}
          onClose={() => setEditingMed(null)}
          onSave={(updated) => {
            setMedicines((prev) => prev.map((m) => (m.id === updated.id ? { ...updated, today_logs: m.today_logs } : m)))
            setEditingMed(null)
            showToast('✓ Medicine details updated')
          }}
        />
      )}

      {toast && <Toast message={toast} type="success" />}
    </>
  )
}
