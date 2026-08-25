import { useEffect, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
}

export default function Modal({ open, onClose, title, children, width = 'max-w-lg' }: ModalProps): ReactElement | null {
  const { t } = useTranslation()
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={`w-full ${width} max-h-[85vh] overflow-y-auto border border-border bg-canvas-raised shadow-overlay`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-soft px-3">
          <span className="text-[13px] font-medium text-text">{title}</span>
          <button
            onClick={onClose}
            className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-muted hover:text-text"
            aria-label={t('actions.close')}
          >
            ×
          </button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>
  )
}
