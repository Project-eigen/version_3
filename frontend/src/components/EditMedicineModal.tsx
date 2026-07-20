import { useState, useRef } from 'react'
import Modal from './Modal'
import PhotoSourceSheet from './PhotoSourceSheet'
import CameraCapture from './CameraCapture'
import api, { getImageUrl } from '../api/client'
import type { MedicineEntry, TimeSlot } from '../types'
import { Pill } from 'lucide-react'

const TIME_SLOTS: { key: TimeSlot; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
  { key: 'night', label: 'Night' },
]

interface EditMedicineModalProps {
  med: MedicineEntry
  onClose: () => void
  onSave: (updated: MedicineEntry) => void
}

export default function EditMedicineModal({ med, onClose, onSave }: EditMedicineModalProps) {
  const [name, setName] = useState(med.name)
  const [dosage, setDosage] = useState(med.dosage || '')
  const [schedule, setSchedule] = useState<TimeSlot[]>(med.schedule || [])
  const [days, setDays] = useState(med.days != null ? String(med.days) : '')
  const [instructions, setInstructions] = useState(med.instructions || '')
  const [packImagePreview, setPackImagePreview] = useState<string | null>(med.pack_image_url)
  const [packFile, setPackFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const toggleSchedule = (slot: TimeSlot) => {
    setSchedule((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot],
    )
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPackFile(file)
      setPackImagePreview(URL.createObjectURL(file))
    }
    // Reset so the same file can be re-selected if needed
    e.target.value = ''
  }

  // In-page webcam capture returned a file
  const handleCameraCapture = (file: File) => {
    setPackFile(file)
    setPackImagePreview(URL.createObjectURL(file))
  }

  const handleCameraSelect = () => { setCameraOpen(true) }
  const handleGallerySelect = () => { galleryInputRef.current?.click() }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setSaving(true)
    setSaveError('')
    try {
      const formData = new FormData()
      formData.append('name', name)
      formData.append('dosage', dosage)
      formData.append('schedule', JSON.stringify(schedule))
      formData.append('days', days)
      formData.append('instructions', instructions)
      if (packFile) formData.append('pack_image', packFile)

      const res = await api.post(`/medicine/update/${med.id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      if (res.data.medicine) onSave(res.data.medicine)
    } catch (err) {
      if (import.meta.env.DEV) console.error(err)
      setSaveError('Could not save medicine details. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit medicine"
      titleId="edit-med-title"
      variant="center"
      className="edit-modal-content"
    >
      <form onSubmit={handleSave} className="edit-modal-form">
        <div className="field-row">
          <label className="field-label" htmlFor="edit-med-name">
            Medicine name
          </label>
          <input
            id="edit-med-name"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Paracetamol 650mg"
            required
            data-autofocus
          />
        </div>

        <div className="field-row-split">
          <div className="field-row field-row-grow">
            <label className="field-label" htmlFor="edit-med-dosage">
              Dosage
            </label>
            <input
              id="edit-med-dosage"
              className="field-input"
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="e.g. 1 tab"
            />
          </div>
          <div className="field-row field-row-narrow">
            <label className="field-label" htmlFor="edit-med-days">
              Days
            </label>
            <input
              id="edit-med-days"
              className="field-input"
              type="number"
              min="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="5"
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field-label" id="edit-med-schedule-label">
            Schedule
          </div>
          <div
            className="schedule-chips schedule-chips-mt"
            role="group"
            aria-labelledby="edit-med-schedule-label"
          >
            {TIME_SLOTS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`schedule-chip ${key} ${schedule.includes(key) ? 'selected' : ''}`}
                onClick={() => toggleSchedule(key)}
                aria-pressed={schedule.includes(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <label className="field-label" htmlFor="edit-med-instructions">
            Instructions
          </label>
          <input
            id="edit-med-instructions"
            className="field-input"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. After food"
          />
        </div>

        <div className="field-row">
          <div className="field-label">Packaging photo</div>
          <div className="edit-photo-row">
            <div className="edit-photo-preview">
              {packImagePreview ? (
                <img src={getImageUrl(packImagePreview)} alt="" />
              ) : (
                <Pill size={20} color="var(--text-muted)" aria-hidden="true" />
              )}
            </div>
            <button
              type="button"
              className="attach-photo-row-btn"
              onClick={() => setPhotoSheetOpen(true)}
            >
              {packImagePreview ? 'Change photo' : 'Add photo'}
            </button>

            {/* Gallery input only — camera handled by CameraCapture overlay */}
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              className="visually-hidden"
              id="edit-pack-gallery-input"
            />
          </div>
        </div>

        {saveError && (
          <p className="field-error" role="alert">
            {saveError}
          </p>
        )}

        <div className="edit-modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {/* Photo Source Picker Sheet */}
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
    </Modal>
  )
}
