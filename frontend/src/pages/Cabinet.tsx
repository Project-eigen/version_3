import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import AppLayout from '../components/AppLayout'
import api from '../api/client'
import type { User, MedicineEntry, TimeSlot } from '../types'
import { Pill, Archive, X, Trash2 } from 'lucide-react'

const TIME_SLOTS: { key: TimeSlot; label: string; time: string }[] = [
  { key: 'morning', label: 'Morning', time: '8:00 AM' },
  { key: 'afternoon', label: 'Afternoon', time: '1:00 PM' },
  { key: 'evening', label: 'Evening', time: '6:00 PM' },
  { key: 'night', label: 'Night', time: '10:00 PM' },
]

interface MedCardProps {
  med: MedicineEntry
  slot: TimeSlot
  onLog: (entryId: number, slot: TimeSlot) => Promise<void>
  onImageClick: (url: string) => void
  onDelete: (entryId: number) => Promise<void>
}

function MedicineCard({ med, slot, onLog, onImageClick, onDelete }: MedCardProps) {
  const isLogged = med.today_logs?.includes(slot) ?? false
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const startHold = () => {
    if (isLogged) return
    setHolding(true)
    setProgress(0)
    let p = 0
    progressTimer.current = setInterval(() => {
      p += 5
      setProgress(p)
      if (p >= 100) {
        clearInterval(progressTimer.current!)
      }
    }, 40)
    holdTimer.current = setTimeout(() => {
      onLog(med.id, slot)
      setHolding(false)
      setProgress(0)
    }, 800)
  }

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    if (progressTimer.current) clearInterval(progressTimer.current)
    setHolding(false)
    setProgress(0)
  }

  const handleThumbClick = () => {
    const imgUrl = med.pack_image_url || med.scan_image_url
    if (imgUrl) {
      onImageClick(imgUrl)
    }
  }

  return (
    <div className={`medicine-card ${slot}`}>
      {/* Image thumbnail */}
      <div
        className="med-thumb"
        onClick={handleThumbClick}
        style={{ cursor: med.pack_image_url || med.scan_image_url ? 'pointer' : 'default' }}
      >
        {med.pack_image_url || med.scan_image_url ? (
          <img
            src={med.pack_image_url || med.scan_image_url || ''}
            alt={med.name}
            width={56}
            height={56}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
          />
        ) : (
          <Pill size={22} color="var(--text-muted)" />
        )}
      </div>

      {/* Info */}
      <div className="med-info" style={{ flex: 1 }}>
        <div className="med-name">{med.name}</div>
        {med.dosage && <div className="med-dosage">{med.dosage}</div>}
      </div>

      {/* Action panel: Delete + Hold button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="delete-med-btn"
          onClick={() => {
            if (confirm(`Are you sure you want to permanently delete ${med.name} from the cabinet?`)) {
              onDelete(med.id)
            }
          }}
          aria-label="Delete medicine"
          type="button"
        >
          <Trash2 size={16} />
        </button>

        <button
          className={`hold-btn ${isLogged ? 'logged' : 'pending'}`}
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          style={
            holding && !isLogged
              ? {
                  background: `linear-gradient(to right, #16a34a ${progress}%, #ef4444 ${progress}%)`,
                }
              : undefined
          }
          aria-label={isLogged ? 'Logged' : 'Hold to log'}
          id={`log-btn-${med.id}-${slot}`}
        >
          {isLogged ? 'LOGGED' : 'HOLD TO LOG'}
        </button>
      </div>
    </div>
  )
}

export default function Cabinet() {
  const { user, activeMemberId, setActiveMemberId } = useAuth()
  const [members, setMembers] = useState<User[]>([])
  const [medicines, setMedicines] = useState<MedicineEntry[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [activeLightboxImage, setActiveLightboxImage] = useState<string | null>(null)
  const hasFetchedOnce = useRef(false)

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
    } catch {} finally {
      setLoading(false)
      setIsFetching(false)
    }
  }, [])

  // On mount: fetch everything in parallel for speed
  useEffect(() => {
    if (!user?.id) return
    const init = async () => {
      const [membersRes, inboxRes] = await Promise.allSettled([
        api.get('/family/members'),
        api.get('/family/inbox'),
      ])
      if (membersRes.status === 'fulfilled') setMembers(membersRes.value.data.members || [])
      if (inboxRes.status === 'fulfilled') setInboxCount(inboxRes.value.data.requests?.length ?? 0)
    }
    init()
  }, [user])

  useEffect(() => {
    if (activeMemberId) {
      fetchCabinet(activeMemberId)
    }
  }, [activeMemberId, fetchCabinet])

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

  const handleDeleteMed = async (entryId: number) => {
    try {
      await api.delete(`/medicine/delete/${entryId}`)
      showToast('✓ Medicine deleted permanently')
      setMedicines((prev) => prev.filter((m) => m.id !== entryId))
    } catch {
      showToast('Failed to delete medicine')
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
        inboxCount={inboxCount}
      >
        {loading ? (
          <div style={{ padding: '12px 12px 0' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton-card" style={{ marginBottom: 8 }}>
                <div className="skeleton-thumb" />
                <div style={{ flex: 1 }}>
                  <div className="skeleton-line" style={{ width: '60%', marginBottom: 8 }} />
                  <div className="skeleton-line" style={{ width: '40%', height: 10 }} />
                </div>
              </div>
            ))}
          </div>
        ) : !hasMedicines ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Archive size={48} color="var(--text-muted)" />
            </div>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Cabinet is empty</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Tap the scan button to add medicines
            </p>
          </div>
        ) : (
          <div style={{ paddingBottom: 16, opacity: isFetching ? 0.65 : 1, transition: 'opacity 0.2s ease' }}>
            <div className="cabinet-hero">
              <span className="cabinet-hero-title">Today's Schedule</span>
              <span className="cabinet-hero-date">
                {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
            </div>
            {TIME_SLOTS.map(({ key, label, time }) => {
              const meds = medicinesBySlot(key)
              if (meds.length === 0) return null
              return (
                <div key={key}>
                  <div className={`time-band-header ${key}`}>
                    <span>
                      {label.toUpperCase()} ({time})
                    </span>
                  </div>
                  {meds.map((med) => (
                    <MedicineCard
                      key={med.id}
                      med={med}
                      slot={key}
                      onLog={handleLog}
                      onImageClick={setActiveLightboxImage}
                      onDelete={handleDeleteMed}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </AppLayout>

      {/* Image Lightbox Modal */}
      {activeLightboxImage && (
        <div className="lightbox-overlay" onClick={() => setActiveLightboxImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={activeLightboxImage} alt="Fullscreen Medicine" className="lightbox-image" />
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

      {toast && <div className="toast success">{toast}</div>}
    </>
  )
}
