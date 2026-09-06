import { createContext } from 'react'

// Split out of ToastProvider.tsx purely so that file can stay a component-only
// export (required for Fast Refresh). See ToastProvider.tsx for the toast system
// itself.

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastContextValue {
  push: (message: string, variant: ToastVariant) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
