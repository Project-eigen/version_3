import { useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDialogA11y } from '../hooks/useDialogA11y'

export type ModalVariant = 'sheet' | 'center'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  titleId?: string
  children: ReactNode
  variant?: ModalVariant
  /** Extra class on the dialog panel */
  className?: string
  /** Extra class on the overlay */
  overlayClassName?: string
}

/**
 * Shared product dialog: Escape, focus trap, restore focus, aria-modal.
 * Sheet = bottom sheet; center = mid-screen panel.
 * Animated dynamically with Framer Motion.
 */
export default function Modal({
  open,
  onClose,
  title,
  titleId = 'dialog-title',
  children,
  variant = 'sheet',
  className = '',
  overlayClassName = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogA11y(open, onClose, panelRef)

  const overlayCls = [
    'modal-overlay',
    variant === 'center' ? 'modal-overlay-center' : '',
    overlayClassName,
  ]
    .filter(Boolean)
    .join(' ')

  const panelCls = [
    variant === 'sheet' ? 'modal-sheet' : 'modal-center-panel',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={overlayCls}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            ref={panelRef}
            initial={variant === 'sheet' ? { y: '100%' } : { scale: 0.92, opacity: 0 }}
            animate={variant === 'sheet' ? { y: 0 } : { scale: 1, opacity: 1 }}
            exit={variant === 'sheet' ? { y: '100%' } : { scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className={panelCls}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {variant === 'sheet' && <div className="modal-handle" aria-hidden="true" />}
            {title && (
              <h2 id={titleId} className="modal-title">
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
