import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import AppLayout from '../components/AppLayout'
import api, { getImageUrl } from '../api/client'
import type { User, MedicineEntry, TimeSlot } from '../types'
import { Pill, Archive, X, Trash2, Pencil } from 'lucide-react'

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
  onEdit: (med: MedicineEntry) => void
}

function MedicineCard({ med, slot, onLog, onImageClick, onDelete, onEdit }: MedCardProps) {
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

  return (
    <div className={`medicine-card-v2 ${slot}`}>
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
            <Pill size={22} color="var(--text-muted)" />
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
            onClick={() => {
              if (confirm(`Are you sure you want to permanently delete ${med.name} from the cabinet?`)) {
                onDelete(med.id)
              }
            }}
            aria-label="Delete medicine"
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="card-bottom">
        <button
          className={`hold-log-bar ${isLogged ? 'logged' : 'pending'}`}
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          style={
            holding && !isLogged
              ? {
                  background: `linear-gradient(to right, var(--logged-color) ${progress}%, var(--danger-color) ${progress}%)`,
                }
              : undefined
          }
          aria-label={isLogged ? 'Logged' : 'Hold to log'}
          id={`log-btn-${med.id}-${slot}`}
          type="button"
        >
          {isLogged ? '✓ DOSE LOGGED' : 'HOLD TO LOG DOSE'}
        </button>
      </div>
    </div>
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
        }).catch(() => {})
      }
    } catch {} finally {
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
                      {label.toUpperCase()} ({timeDisplay})
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
                      onEdit={setEditingMed}
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
            setMedicines((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            setEditingMed(null)
            showToast('✓ Medicine details updated')
          }}
        />
      )}

      {toast && <div className="toast success">{toast}</div>}
    </>
  )
}

interface EditMedicineModalProps {
  med: MedicineEntry
  onClose: () => void
  onSave: (updated: MedicineEntry) => void
}

function EditMedicineModal({ med, onClose, onSave }: EditMedicineModalProps) {
  const [name, setName] = useState(med.name)
  const [dosage, setDosage] = useState(med.dosage || '')
  const [schedule, setSchedule] = useState<TimeSlot[]>(med.schedule || [])
  const [days, setDays] = useState(med.days != null ? String(med.days) : '')
  const [instructions, setInstructions] = useState(med.instructions || '')
  const [packImagePreview, setPackImagePreview] = useState<string | null>(med.pack_image_url)
  const [packFile, setPackFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const toggleSchedule = (slot: TimeSlot) => {
    setSchedule((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
    )
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPackFile(file)
      setPackImagePreview(URL.createObjectURL(file))
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('name', name)
      formData.append('dosage', dosage)
      formData.append('schedule', JSON.stringify(schedule))
      formData.append('days', days)
      formData.append('instructions', instructions)
      if (packFile) {
        formData.append('pack_image', packFile)
      }

      const res = await api.post(`/medicine/update/${med.id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      if (res.data.medicine) {
        onSave(res.data.medicine)
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error(err)
      alert('Failed to update medicine parameters.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="lightbox-overlay" style={{ zIndex: 600 }}>
      <div className="edit-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-header">
          <h3>Edit Medicine</h3>
          <button className="edit-modal-close" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="edit-modal-form">
          <div className="field-row">
            <div className="field-label">Medicine Name</div>
            <input
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Paracetamol 650mg"
              required
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field-row" style={{ flex: 1 }}>
              <div className="field-label">Dosage</div>
              <input
                className="field-input"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g. 1 tab"
              />
            </div>
            <div className="field-row" style={{ width: '90px' }}>
              <div className="field-label">Days</div>
              <input
                className="field-input"
                type="number"
                min="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field-label">Schedule</div>
            <div className="schedule-chips" style={{ marginTop: 4 }}>
              {TIME_SLOTS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`schedule-chip ${key} ${schedule.includes(key) ? 'selected' : ''}`}
                  onClick={() => toggleSchedule(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field-label">Instructions</div>
            <input
              className="field-input"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. After Food"
            />
          </div>

          <div className="field-row">
            <div className="field-label">Packaging Photo</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <div className="edit-photo-preview">
                {packImagePreview ? (
                  <img src={getImageUrl(packImagePreview)} alt="Pack Preview" />
                ) : (
                  <Pill size={20} color="var(--text-muted)" />
                )}
              </div>
              <button
                type="button"
                className="attach-photo-row-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Change Photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelect}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="edit-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
