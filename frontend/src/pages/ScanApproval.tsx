import React, { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Header from '../components/Header'
import PhotoSourceSheet from '../components/PhotoSourceSheet'
import CameraCapture from '../components/CameraCapture'
import api, { getImageUrl } from '../api/client'
import type { TimeSlot, User } from '../types'
import { Pencil, ImagePlus, Check, Trash2, Plus, X } from 'lucide-react'

const SCHEDULE_OPTIONS: { key: TimeSlot; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
  { key: 'night', label: 'Night' },
]

interface EditableMedicine {
  id: string
  name: string
  dosage: string
  schedule: TimeSlot[]
  days: string
  instructions: string
  packImage: string | null
  packFile: File | null
  confidence?: 'high' | 'medium' | 'low' | null
}

export default function ScanApproval() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, activeMemberId, setActiveMemberId } = useAuth()
  const state = location.state as {
    scanData: {
      scan_image_url: string
      extracted: {
        name?: string | null
        dosage?: string | null
        schedule?: TimeSlot[]
        days?: number | null
        instructions?: string | null
        unparsed_lines?: string[]
        medicines?: Array<{
          name: string | null
          dosage: string | null
          schedule: TimeSlot[]
          days: number | null
          instructions: string | null
        }>
      }
    }
    capturedImage: string
    targetMemberId?: number
  }

  const [medicines, setMedicines] = useState<EditableMedicine[]>(() => {
    const extractedList = state?.scanData?.extracted?.medicines || []
    const singleExtracted = state?.scanData?.extracted

    if (extractedList.length > 0) {
      return extractedList.map((m, idx) => ({
        id: `extracted-${idx}-${Date.now()}`,
        name: m.name || '',
        dosage: m.dosage || '',
        schedule: m.schedule || [],
        days: m.days != null ? String(m.days) : '',
        instructions: m.instructions || '',
        packImage: null,
        packFile: null,
        confidence: (m as any).confidence || null,
      }))
    } else if (singleExtracted && (singleExtracted.name || singleExtracted.dosage)) {
      return [
        {
          id: `extracted-single-${Date.now()}`,
          name: singleExtracted.name || '',
          dosage: singleExtracted.dosage || '',
          schedule: singleExtracted.schedule || [],
          days: (singleExtracted as any).days != null ? String((singleExtracted as any).days) : '',
          instructions: (singleExtracted as any).instructions || '',
          packImage: null,
          packFile: null,
          confidence: (singleExtracted as any).confidence || null,
        },
      ]
    }

    // Default fallback
    return [
      {
        id: `blank-${Date.now()}`,
        name: '',
        dosage: '',
        schedule: [],
        days: '',
        instructions: '',
        packImage: null,
        packFile: null,
      },
    ]
  })

  const [loading, setLoading] = useState(false)
  const [currentUploadIdx, setCurrentUploadIdx] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [activePhotoIdx, setActivePhotoIdx] = useState<number | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [unparsedLines, setUnparsedLines] = useState<string[]>(() => {
    return state?.scanData?.extracted?.unparsed_lines || []
  })

  const [members, setMembers] = useState<User[]>([])
  const [targetMemberId, setTargetMemberId] = useState<number>(() => {
    return state?.targetMemberId ?? (activeMemberId || user?.id || 0)
  })

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const res = await api.get('/family/members')
        setMembers(res.data.members || [])
      } catch (e) {
        if (import.meta.env.DEV) console.error('[ScanApproval] Failed to fetch members:', e)
      }
    }
    fetchMembers()
  }, [])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const toggleScheduleForMed = (idx: number, slot: TimeSlot) => {
    setMedicines((prev) =>
      prev.map((med, i) => {
        if (i !== idx) return med
        const newSched = med.schedule.includes(slot)
          ? med.schedule.filter((s) => s !== slot)
          : [...med.schedule, slot]
        return { ...med, schedule: newSched }
      })
    )
  }

  const updateName = (idx: number, nameVal: string) => {
    setMedicines((prev) =>
      prev.map((med, i) => (i === idx ? { ...med, name: nameVal } : med))
    )
  }

  const updateDosage = (idx: number, dosageVal: string) => {
    setMedicines((prev) =>
      prev.map((med, i) => (i === idx ? { ...med, dosage: dosageVal } : med))
    )
  }

  const updateDays = (idx: number, val: string) => {
    setMedicines((prev) =>
      prev.map((med, i) => (i === idx ? { ...med, days: val } : med))
    )
  }

  const updateInstructions = (idx: number, val: string) => {
    setMedicines((prev) =>
      prev.map((med, i) => (i === idx ? { ...med, instructions: val } : med))
    )
  }

  const deleteMedicine = (idx: number) => {
    if (medicines.length === 1) {
      showToast('Must have at least one medicine', 'error')
      return
    }
    setMedicines((prev) => prev.filter((_, i) => i !== idx))
  }

  const addBlankMedicine = () => {
    setMedicines((prev) => [
      ...prev,
      {
        id: `blank-${prev.length}-${Date.now()}`,
        name: '',
        dosage: '',
        schedule: [],
        days: '',
        instructions: '',
        packImage: null,
        packFile: null,
      },
    ])
  }

  const handleAddUnparsed = (line: string) => {
    setMedicines((prev) => [
      ...prev,
      {
        id: `unparsed-${Date.now()}`,
        name: line,
        dosage: '',
        schedule: [],
        days: '',
        instructions: '',
        packImage: null,
        packFile: null,
      },
    ])
    setUnparsedLines((prev) => prev.filter((l) => l !== line))
  }

  // Open the source picker; store which card's photo we're updating
  const triggerPhotoUpload = (idx: number) => {
    setActivePhotoIdx(idx)
    setPhotoSheetOpen(true)
  }

  // Opens the in-page webcam modal
  const handleCameraSelect = () => {
    setCameraOpen(true)
  }

  // Called when user picks "Gallery" from the sheet
  const handleGallerySelect = () => {
    galleryInputRef.current?.click()
  }

  // Called by CameraCapture when the user takes a photo
  const handleCameraCapture = (file: File) => {
    if (activePhotoIdx === null) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setMedicines((prev) =>
        prev.map((med, idx) =>
          idx === activePhotoIdx
            ? { ...med, packImage: ev.target?.result as string, packFile: file }
            : med
        )
      )
    }
    reader.readAsDataURL(file)
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && activePhotoIdx !== null) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setMedicines((prev) =>
          prev.map((med, idx) =>
            idx === activePhotoIdx
              ? { ...med, packImage: ev.target?.result as string, packFile: file }
              : med
          )
        )
      }
      reader.readAsDataURL(file)
    }
    // Reset the input so the same file can be selected again if needed
    e.target.value = ''
  }

  const handleConfirmAll = async () => {
    const invalid = medicines.some((med) => !med.name.trim())
    if (invalid) {
      showToast('All medicine cards must have a name', 'error')
      return
    }

    setLoading(true)
    try {
      // 1. Upload custom pack images in parallel if they exist
      const medicinesWithUrls = await Promise.all(
        medicines.map(async (med, idx) => {
          setCurrentUploadIdx(idx)
          let pack_image_url = med.packImage
          if (med.packFile) {
            const formData = new FormData()
            formData.append('image', med.packFile)
            const uploadRes = await api.post('/medicine/upload-image', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            })
            pack_image_url = uploadRes.data.url
          }
          return {
            name: med.name.trim(),
            dosage: med.dosage.trim(),
            schedule: med.schedule,
            days: med.days.trim(),
            instructions: med.instructions.trim(),
            pack_image_url,
          }
        })
      )

      setCurrentUploadIdx(null)

      // 2. Save all medicines in a single batch call
      await api.post('/medicine/batch-add', {
        medicines: medicinesWithUrls,
        scan_image_url: state?.scanData?.scan_image_url || '',
        target_user_id: targetMemberId,
      })

      showToast(`Added ${medicines.length} medicines successfully!`, 'success')
      setTimeout(() => navigate('/cabinet', { replace: true }), 1200)
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save some medicines', 'error')
      setLoading(false)
      setCurrentUploadIdx(null)
    }
  }

  const handleSelectMember = (id: number) => {
    setTargetMemberId(id)
    setActiveMemberId(id)
  }

  return (
    <div className="scan-approve-shell">
      <Header />

      {members.length > 1 && (
        <div className="scan-target-bar">
          <div className="scan-target-label">
            Add these to the cabinet of
          </div>
          <div className="scan-target-pills">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                className={`family-pill ${targetMemberId === member.id ? 'active' : ''}`}
                onClick={() => handleSelectMember(member.id)}
              >
                {member.avatar_url ? (
                  <img src={member.avatar_url} alt={member.name} className="pill-avatar" width={28} height={28} loading="lazy" decoding="async" />
                ) : (
                  <div className="pill-avatar-placeholder">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span>{member.id === user?.id ? 'Me' : member.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scan-approve-body">
        {state?.capturedImage && (
          <div className="scan-preview-header-card">
            <div className="preview-thumbnail-wrap" onClick={() => setLightboxOpen(true)}>
              <img src={getImageUrl(state.capturedImage)} alt="Scanned document" className="preview-thumbnail" />
              <div className="preview-thumbnail-overlay">
                <span>Tap to view scanned document</span>
              </div>
            </div>
          </div>
        )}

        <div className="extracted-section extracted-section-pad">
          <div className="extracted-header">
            <span className="extracted-label">
              <Check size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
              Review scanned list
            </span>
            <span className="section-label tabular-nums">
              {medicines.length} found
            </span>
          </div>

          {unparsedLines.length > 0 && (
            <div className="unparsed-alert-box">
              <span className="unparsed-alert-title">Unparsed text detected</span>
              <p className="unparsed-alert-desc">
                Some lines could not be parsed cleanly. Tap a line to add it as a medicine card:
              </p>
              <div className="unparsed-chips">
                {unparsedLines.map((line, index) => (
                  <button
                    key={index}
                    className="unparsed-chip-btn"
                    onClick={() => handleAddUnparsed(line)}
                    type="button"
                  >
                    + {line}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cards List */}
          <div className="medicines-approval-list">
            {medicines.map((med, idx) => (
              <div className="med-approval-card" key={med.id}>
                {/* Card Header */}
                <div className="med-card-header">
                  <div className="med-card-header-left">
                    <span className="med-card-index">Medicine #{idx + 1}</span>
                    {med.confidence && (
                      <span className={`confidence-badge ${med.confidence}`}>
                        {med.confidence === 'high' ? 'Certain' : med.confidence === 'medium' ? 'Review' : 'Ambiguous'}
                      </span>
                    )}
                  </div>
                  <button
                    className="delete-card-btn"
                    onClick={() => deleteMedicine(idx)}
                    aria-label={`Delete medicine #${idx + 1}`}
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {/* Grid Inputs */}
                <div className="med-card-body">
                  <div className="approval-fields-grid">
                    <div className="field-row field-grow">
                      <label className="field-label" htmlFor={`med-name-${idx}`}>Name</label>
                      <div className="field-wrapper">
                        <input
                          id={`med-name-${idx}`}
                          className="field-input"
                          value={med.name}
                          onChange={(e) => updateName(idx, e.target.value)}
                          placeholder="Medicine name"
                        />
                        <Pencil size={12} className="field-edit-icon" aria-hidden="true" />
                      </div>
                    </div>

                    <div className="field-row field-w-dosage">
                      <label className="field-label" htmlFor={`med-dosage-${idx}`}>Dosage</label>
                      <div className="field-wrapper">
                        <input
                          id={`med-dosage-${idx}`}
                          className="field-input"
                          value={med.dosage}
                          onChange={(e) => updateDosage(idx, e.target.value)}
                          placeholder="e.g. 500mg"
                        />
                        <Pencil size={12} className="field-edit-icon" aria-hidden="true" />
                      </div>
                    </div>
                  </div>

                  <div className="field-row field-mt">
                    <div className="field-label">Schedule</div>
                    <div className="schedule-chips">
                      {SCHEDULE_OPTIONS.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`schedule-chip ${key} ${med.schedule.includes(key) ? 'selected' : ''}`}
                          onClick={() => toggleScheduleForMed(idx, key)}
                          aria-pressed={med.schedule.includes(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Days + Instructions row */}
                  <div className="approval-fields-grid" style={{ marginTop: 8 }}>
                    <div className="field-row" style={{ width: '80px' }}>
                      <div className="field-label">Days</div>
                      <div className="field-wrapper">
                        <input
                          className="field-input"
                          type="number"
                          min="1"
                          max="365"
                          value={med.days}
                          onChange={(e) => updateDays(idx, e.target.value)}
                          placeholder="e.g. 5"
                          aria-label={`Medicine #${idx + 1} Days`}
                        />
                        <Pencil size={12} className="field-edit-icon" />
                      </div>
                    </div>

                    <div className="field-row" style={{ flex: 1 }}>
                      <div className="field-label">Instructions</div>
                      <div className="field-wrapper">
                        <input
                          className="field-input"
                          value={med.instructions}
                          onChange={(e) => updateInstructions(idx, e.target.value)}
                          placeholder="e.g. After Food"
                          aria-label={`Medicine #${idx + 1} Instructions`}
                        />
                        <Pencil size={12} className="field-edit-icon" />
                      </div>
                    </div>
                  </div>

                  {/* Attachment Row */}
                  <div className="med-attachment-row" style={{ marginTop: 12 }}>
                    <div className="attachment-preview-box">
                      {med.packImage ? (
                        <img src={getImageUrl(med.packImage)} alt="Pack preview" className="mini-preview-img" />
                      ) : (
                        <div className="placeholder-box">
                          <ImagePlus size={16} />
                        </div>
                      )}
                    </div>
                    <div className="attachment-details">
                      <span className="attachment-title">Individual Photo</span>
                      <span className="attachment-desc">
                        {med.packImage ? 'Custom photo attached' : 'Using scanned page as default'}
                      </span>
                    </div>
                    <button
                      className="attach-photo-row-btn"
                      onClick={() => triggerPhotoUpload(idx)}
                      type="button"
                    >
                      {med.packImage ? 'Change' : 'Add Photo'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Medicine Button */}
          <button className="add-manual-card-btn" onClick={addBlankMedicine} type="button">
            <Plus size={16} />
            Add Another Medicine
          </button>
        </div>

        {/* Global actions */}
        <div style={{ padding: '12px 16px 8px' }}>
          <button
            className="btn-primary"
            onClick={handleConfirmAll}
            disabled={loading || medicines.length === 0}
            id="confirm-add-btn"
            type="button"
          >
            {loading ? (
              <span className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            ) : (
              <>
                <Check size={18} />
                Confirm &amp; Add All to Cabinet
              </>
            )}
          </button>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <button
            className="btn-ghost"
            onClick={() => navigate('/scan', { replace: true })}
            id="retake-photo-btn"
            style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}
            type="button"
          >
            Cancel &amp; Retake Scan
          </button>
        </div>
      </div>

      {/* Gallery input — no capture attribute, shows file picker / photos */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handlePhotoSelect}
        id="pack-image-gallery-input"
      />

      {/* Photo Source Picker */}
      <PhotoSourceSheet
        open={photoSheetOpen}
        onCamera={handleCameraSelect}
        onGallery={handleGallerySelect}
        onClose={() => setPhotoSheetOpen(false)}
      />

      {/* In-page webcam capture */}
      <CameraCapture
        open={cameraOpen}
        onCapture={handleCameraCapture}
        onClose={() => setCameraOpen(false)}
      />

      {/* Scanned Image Lightbox Modal */}
      {lightboxOpen && (
        <div className="lightbox-overlay" onClick={() => setLightboxOpen(false)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={getImageUrl(state?.capturedImage)} alt="Fullscreen Scan Reference" className="lightbox-image" />
            <button
              className="lightbox-close"
              onClick={() => setLightboxOpen(false)}
              aria-label="Close fullscreen preview"
              type="button"
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Sequential upload spinner overlay */}
      {loading && (
        <div
          className="loading-overlay"
          style={{
            position: 'fixed',
            zIndex: 300,
            background: 'rgba(15, 22, 41, 0.85)',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div className="loading-spinner" />
          <span style={{ fontWeight: 600, color: 'white', marginTop: 16 }}>
            {currentUploadIdx !== null
              ? `Saving medicine ${currentUploadIdx + 1} of ${medicines.length}…`
              : 'Saving medicines…'}
          </span>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
