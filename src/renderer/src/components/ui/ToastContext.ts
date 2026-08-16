import { createContext } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastContextValue {
  push: (message: string, variant: ToastVariant) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
