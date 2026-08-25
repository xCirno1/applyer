import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'
import Button from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): ReactElement | null {
  const { t } = useTranslation()
  if (!open) return null

  return (
    <Modal open={open} onClose={onCancel} title={title} width="max-w-sm">
      <p className="text-[13px] text-text-muted">{message}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          {t('actions.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmLabel ?? t('actions.confirm')}
        </Button>
      </div>
    </Modal>
  )
}
