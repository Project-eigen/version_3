import { useRef, useState, useCallback, useEffect } from 'react'
import Webcam from 'react-webcam'
import { X, Camera, AlertCircle, RefreshCw } from 'lucide-react'

interface CameraCaptureProps {
  open: boolean
  onCapture: (file: File) => void
  onClose: () => void
}

/**
 * In-page webcam capture overlay.
 * Works on desktop (laptop webcam) and mobile (rear camera via facingMode).
 * On capture, converts the frame to a File and calls onCapture().
 */
export default function CameraCapture({ open, onCapture, onClose }: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)

  // Enumerate all available camera input devices
  const handleDevices = useCallback((mediaDevices: MediaDeviceInfo[]) => {
    const videoDevices = mediaDevices.filter(({ kind }) => kind === 'videoinput')
    setDevices(videoDevices)
    if (videoDevices.length > 0) {
      // Prioritize environment camera by default on mobile if present
      const envDevice = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'))
      setActiveDeviceId(envDevice ? envDevice.deviceId : videoDevices[0].deviceId)
    }
  }, [])

  useEffect(() => {
    if (open) {
      navigator.mediaDevices.enumerateDevices()
        .then(handleDevices)
        .catch(() => {
          // Silent fallback if permission not granted yet
        })
    }
  }, [open, handleDevices])

  const switchCamera = () => {
    if (devices.length <= 1 || !activeDeviceId) return
    const currentIndex = devices.findIndex((d) => d.deviceId === activeDeviceId)
    const nextIndex = (currentIndex + 1) % devices.length
    setActiveDeviceId(devices[nextIndex].deviceId)
  }

  const handleCapture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot()
    if (!imageSrc) return

    setCapturing(true)

    // Convert base64 data URL → Blob → File
    fetch(imageSrc)
      .then((r) => r.blob())
      .then((blob) => {
        const file = new File([blob], `pack-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        onCapture(file)
        onClose()
      })
      .catch(() => {
        setError('Failed to process the captured image. Please try again.')
      })
      .finally(() => setCapturing(false))
  }, [onCapture, onClose])

  if (!open) return null

  return (
    <div className="cam-capture-overlay" role="dialog" aria-modal="true" aria-label="Take a photo">
      {/* Top bar */}
      <div className="cam-capture-topbar">
        <span className="cam-capture-title">Take a Photo</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {devices.length > 1 && (
            <button
              type="button"
              className="cam-capture-close"
              onClick={switchCamera}
              aria-label="Switch camera"
              title="Switch camera device"
            >
              <RefreshCw size={18} />
            </button>
          )}
          <button
            type="button"
            className="cam-capture-close"
            onClick={onClose}
            aria-label="Close camera"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Webcam feed or error */}
      <div className="cam-capture-feed">
        {error ? (
          <div className="cam-capture-error">
            <AlertCircle size={36} color="#f87171" />
            <p>{error}</p>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <Webcam
            ref={webcamRef}
            audio={false}
            playsInline
            screenshotFormat="image/jpeg"
            screenshotQuality={0.92}
            videoConstraints={
              activeDeviceId
                ? {
                    deviceId: { exact: activeDeviceId },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                  }
                : {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                  }
            }
            onUserMediaError={() =>
              setError(
                'Could not access camera.\nCheck that your browser has camera permission and no other app is using it.',
              )
            }
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </div>

      {/* Shutter dock */}
      {!error && (
        <div className="cam-capture-dock">
          <button
            type="button"
            className={`cam-shutter-btn${capturing ? ' capturing' : ''}`}
            onClick={handleCapture}
            disabled={capturing}
            aria-label="Capture photo"
            id="cam-shutter"
          >
            <Camera size={26} />
          </button>
          <span className="cam-capture-hint">Tap to capture</span>
        </div>
      )}
    </div>
  )
}
