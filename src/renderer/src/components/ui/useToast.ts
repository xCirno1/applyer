import { useContext } from 'react'
import { ToastContext } from './ToastContext'

export function useToast(): { success: (msg: string) => void; error: (msg: string) => void; info: (msg: string) => void } {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')

  return {
    success: (msg: string) => ctx.push(msg, 'success'),
    error: (msg: string) => ctx.push(msg, 'error'),
    info: (msg: string) => ctx.push(msg, 'info')
  }
}
