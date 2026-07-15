import React, { useRef, useState, useCallback } from 'react'
import Webcam from 'react-webcam'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import { Zap, ZapOff, Camera, X, Upload, Keyboard } from 'lucide-react'

export default function Scanner() {
  const webcamRef = useRef<Webcam>(null)
  const navigate = useNavigate()
  const { activeMemberId } = useAuth()
  const [capturing, setCapturing] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showTips, setShowTips] = useState(false)
  const [imageQuality, setImageQuality] = useState<'good' | 'poor' | null>(null)
  const [qualityMessage, setQualityMessage] = useState('')

  const analyzeImageQuality = useCallback((imageSrc: string) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        let brightness = 0
        for (let i = 0; i < data.length; i += 4) {
          brightness += (data[i] + data[i + 1] + data[i + 2]) / 3
        }
        brightness /= (data.length / 4)
        let variance = 0
        for (let i = 0; i < data.length; i += 4) {
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
          variance += Math.pow(lum - brightness, 2)
        }
        const contrast = Math.sqrt(variance / (data.length / 4))
        if (brightness < 50) {
          setImageQuality('poor')
          setQualityMessage('Too dark — enable flash or brighter area')
        } else if (brightness > 230) {
          setImageQuality('poor')
          setQualityMessage('Too bright — reduce glare or adjust angle')
        } else if (contrast < 20) {
          setImageQuality('poor')
          setQualityMessage('Low contrast — text may be hard to read')
        } else {
          setImageQuality('good')
          setQualityMessage('Good lighting — ready to scan')
        }
        setTimeout(() => { setImageQuality(null); setQualityMessage('') }, 3000)
      } catch (e) {
        if (import.meta.env.DEV) console.warn('Image quality analysis failed', e)
      }
    }
    img.src = imageSrc
  }, [])

  const toggleFlash = async () => {
    try {
      const stream = webcamRef.current?.video?.srcObject as MediaStream | null
      if (!stream) return
      const track = stream.getVideoTracks()[0]
      const capabilities = track.getCapabilities() as any
      if (capabilities && 'torch' in capabilities) {
        const newFlashState = !flashActive
        await track.applyConstraints({ advanced: [{ torch: newFlashState }] } as any)
        setFlashActive(newFlashState)
      } else {
        alert('Flash/Torch is not supported on this device/camera.')
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to toggle flash', err)
    }
  }


  const handleCapture = useCallback(async () => {
    if (capturing) return
    const imageSrc = webcamRef.current?.getScreenshot()
    if (!imageSrc) return

    setCapturing(true)
    setCapturedPreview(imageSrc)
    analyzeImageQuality(imageSrc)
    try {
      const res = await fetch(imageSrc)
      const blob = await res.blob()
      const file = new File([blob], 'scan.jpg', { type: 'image/jpeg' })
      const formData = new FormData()
      formData.append('image', file)

      const scanRes = await api.post('/medicine/scan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      navigate('/scan/approve', {
        state: {
          scanData: scanRes.data,
          capturedImage: imageSrc,
          targetMemberId: activeMemberId,
        },
      })
    } catch (err: any) {
      if (import.meta.env.DEV) console.error('Scan failed', err)
      const msg = err?.response?.data?.error || 'Scan failed. Please try again.'
      setErrorMsg(msg)
      setTimeout(() => setErrorMsg(''), 4000)
      setCapturing(false)
      setCapturedPreview(null)
    }
  }, [capturing, navigate, activeMemberId])

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setCapturing(true)
    const imageSrc = URL.createObjectURL(file)
    setCapturedPreview(imageSrc)
    analyzeImageQuality(imageSrc)
    try {
      const formData = new FormData()
      formData.append('image', file)

      const scanRes = await api.post('/medicine/scan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      navigate('/scan/approve', {
        state: {
          scanData: scanRes.data,
          capturedImage: imageSrc,
          targetMemberId: activeMemberId,
        },
      })
    } catch (err: any) {
      if (import.meta.env.DEV) console.error('Scan upload failed', err)
      const msg = err?.response?.data?.error || 'Upload failed. Please try again.'
      setErrorMsg(msg)
      setTimeout(() => setErrorMsg(''), 4000)
      setCapturing(false)
      setCapturedPreview(null)
    }
  }, [navigate, activeMemberId])

  return (
    <div className="scanner-fullpage">
      {/* Dark header row */}
      <div className="scanner-top-bar">
        <div className="scanner-brand">
          <div className="scanner-brand-dot" />
          <span>DawaiSathi Scanner</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`flash-toggle-btn ${flashActive ? 'active' : ''}`}
            onClick={toggleFlash}
            type="button"
            aria-label="Toggle Flash"
            id="toggle-flash-btn"
          >
            {flashActive ? <Zap size={18} color="var(--accent-teal)" /> : <ZapOff size={18} color="rgba(255,255,255,0.6)" />}
          </button>
          <button
            className="scanner-close-btn"
            onClick={() => navigate('/cabinet')}
            type="button"
            aria-label="Close scanner"
          >
            <X size={18} color="rgba(255,255,255,0.6)" />
          </button>
        </div>
      </div>

      {/* Full-screen camera view */}
      <div className="scanner-camera-area">
        {capturedPreview && (
          <img
            src={capturedPreview}
            className="scanner-video-feed"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 25 }}
            alt="Captured Preview"
          />
        )}
        {capturing && (
          <div className="scanner-analyzing-overlay">
            <div className="loading-spinner-container">
              <div className="loading-spinner" style={{ borderTopColor: 'var(--accent-teal)', width: 36, height: 36 }} />
            </div>
            <span className="scanner-analyzing-text">Analyzing prescription…</span>
          </div>
        )}
        {cameraError && !capturedPreview ? (
          <div className="scanner-error-state">
            <ZapOff size={52} opacity={0.4} color="white" />
            <p className="scanner-error-title">Camera Unavailable</p>
            <p className="scanner-error-desc">
              To scan prescriptions, allow camera access in your browser settings.
            </p>
            <div className="error-steps">
              <p className="error-step-label">Steps to enable:</p>
              <ol className="error-steps-list">
                <li>Tap the lock icon in the address bar</li>
                <li>Find "Camera" in permissions</li>
                <li>Change to "Allow"</li>
                <li>Refresh this page</li>
              </ol>
            </div>
          </div>
        ) : (
          <>
            {!capturedPreview && (
              <Webcam
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                screenshotQuality={1.0}
                videoConstraints={{
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                }}
                onUserMediaError={() => setCameraError(true)}
                className="scanner-video-feed"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}

            {/* Viewfinder overlay */}
            {!capturedPreview && (
              <div className="scanner-viewfinder">
                <div className="scanner-scan-line" />
                <div className="scanner-corner tl" />
                <div className="scanner-corner tr" />
                <div className="scanner-corner bl" />
                <div className="scanner-corner br" />
              </div>
            )}

            {/* Enhanced Hint Label with Contextual Guidance */}
            <div
              className="scanner-hint-container"
              role="status"
              aria-live="polite"
              aria-label="Scanner guidance"
            >
              <div className="scanner-hint">
                {capturing ? (
                  <span className="hint-text">⏳ Analyzing with AI…</span>
                ) : (
                  <>
                    <span className="hint-icon">📋</span>
                    <div className="hint-text-group">
                      <span className="hint-text">Place prescription inside frame</span>
                      <span className="hint-subtext">Ensure good lighting and clear text</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Contextual Tips for Better Scanning */}
            {!capturing && (
              <div className="scanner-tips-badge" role="complementary">
                <button
                  className="tips-toggle-btn"
                  onClick={() => setShowTips(!showTips)}
                  aria-label="Toggle scanning tips"
                  aria-expanded={showTips}
                  type="button"
                >
                  <span className="tips-icon">💡</span>
                  <span className="tips-label">Tips for better scans</span>
                </button>
                {showTips && (
                  <div className="tips-content">
                    <ul className="tips-list">
                      <li>✓ Ensure bright, even lighting</li>
                      <li>✓ Hold camera steady and parallel</li>
                      <li>✓ Capture entire prescription</li>
                      <li>✓ Avoid shadows and glare</li>
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {imageQuality && (
          <div className="quality-badge" data-quality={imageQuality}>
            {imageQuality === 'good' ? '✓' : '⚠'} {qualityMessage}
          </div>
        )}
      </div>

      {errorMsg && (
        <div style={{
          padding: '10px 16px', margin: '8px 16px', borderRadius: 10,
          background: 'rgba(239, 68, 68, 0.15)', color: '#f87171',
          fontSize: '0.82rem', textAlign: 'center'
        }}>
          {errorMsg}
        </div>
      )}

      {/* Cabinet tip */}
      {!capturing && (
        <div className="cabinet-tip">
          <strong>Tip:</strong> Align prescription so medicine names and time columns are clearly visible
        </div>
      )}

      {/* Capture button pinned above bottom */}
      <div className={`scanner-capture-dock ${capturing ? 'processing-state' : ''}`}>
        
        {/* Left Side: Upload Gallery */}
        <div className="scanner-action-wrapper">
          <label
            className="gallery-btn-small"
            style={{
              cursor: capturing ? 'not-allowed' : 'pointer',
              opacity: capturing ? 0.5 : 1,
              pointerEvents: capturing ? 'none' : 'auto',
            }}
            title="Upload prescription photo"
          >
            <Upload size={20} color="rgba(255,255,255,0.7)" strokeWidth={2} />
            <input
              type="file"
              accept="image/*"
              onChange={handleUpload}
              style={{ display: 'none' }}
              disabled={capturing}
            />
          </label>
          <span className="scanner-action-label">Upload</span>
        </div>

        {/* Center: Primary Shutter Button */}
        <div className="scanner-action-wrapper">
          <button
            className="capture-btn"
            onClick={handleCapture}
            disabled={cameraError || capturing}
            id="capture-btn"
            aria-label="Capture medicine image"
            type="button"
          >
            <Camera size={28} color="#0f172a" strokeWidth={2} />
          </button>
          <span className="scanner-action-label">Take Photo</span>
        </div>

        {/* Right Side: Type Manually Fallback */}
        <div className="scanner-action-wrapper">
          <button
            className="manual-btn-small"
            onClick={() => navigate('/scan/approve', { state: { targetMemberId: activeMemberId } })}
            disabled={capturing}
            title="Type details manually"
            type="button"
          >
            <Keyboard size={20} color="rgba(255,255,255,0.7)" strokeWidth={2} />
          </button>
          <span className="scanner-action-label">Type Manual</span>
        </div>

      </div>
    </div>
  )
}
