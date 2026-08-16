import { useCallback, useState, type ReactElement, type ReactNode } from 'react'
import { ToastContext, type ToastVariant } from './ToastContext'

interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

const VARIANT_ACCENT: Record<ToastVariant, string> = {
  success: 'border-l-success',
  error: 'border-l-danger',
  info: 'border-l-accent'
}

export default function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-3 right-3 z-[100] flex w-80 flex-col gap-1.5">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto border-l-2 bg-canvas-raised px-3 py-2 text-[12px] text-text shadow-pop ${VARIANT_ACCENT[toast.variant]}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
