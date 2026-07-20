import { motion, AnimatePresence } from 'framer-motion'
import { Camera, ImageIcon } from 'lucide-react'

interface PhotoSourceSheetProps {
  open: boolean
  onCamera: () => void
  onGallery: () => void
  onClose: () => void
}

/**
 * Bottom-sheet that lets the user choose between taking a photo with the
 * camera or picking one from their photo gallery / file system.
 * Animated with spring physics.
 */
export default function PhotoSourceSheet({ open, onCamera, onGallery, onClose }: PhotoSourceSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="bottom-sheet-overlay"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Add photo"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="bottom-sheet-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bottom-sheet-drag-handle" />
            <div className="bottom-sheet-title">Add Photo</div>

            <div className="bottom-sheet-options">
              {/* Camera option */}
              <button
                type="button"
                className="bottom-sheet-option"
                onClick={() => { onCamera(); onClose() }}
                id="photo-source-camera"
              >
                <div className="option-icon scan">
                  <Camera size={22} color="var(--accent-teal)" />
                </div>
                <div className="option-text">
                  <span className="option-title">Take a Photo</span>
                  <span className="option-desc">Open camera to photograph the blister pack</span>
                </div>
              </button>

              {/* Gallery option */}
              <button
                type="button"
                className="bottom-sheet-option"
                onClick={() => { onGallery(); onClose() }}
                id="photo-source-gallery"
              >
                <div className="option-icon manual">
                  <ImageIcon size={22} color="var(--accent-cyan)" />
                </div>
                <div className="option-text">
                  <span className="option-title">Choose from Gallery</span>
                  <span className="option-desc">Pick an existing photo from your device</span>
                </div>
              </button>
            </div>

            <button
              type="button"
              className="bottom-sheet-cancel"
              onClick={onClose}
              id="photo-source-cancel"
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
