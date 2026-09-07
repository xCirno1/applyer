import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentPermissions } from '@shared/types/agentPermissions'
import { isAgentPermissions } from '@shared/types/agentPermissions'
import Checkbox from '../ui/Checkbox'
import Skeleton from '../ui/Skeleton'
import Spinner from '../ui/Spinner'
import Button from '../ui/Button'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { useToast } from '../ui/useToast'

/**
 * Compact permissions control beside the embedded terminal. Agent access is
 * changed where the agent is used, without making the user leave the
 * workspace for Settings. The popover keeps both independent permissions in
 * view while one is changed, and every renderer/main boundary is validated
 * before it reaches component state.
 */
export default function AgentPermissionsMenu(): ReactElement {
  const { t } = useTranslation('workspace')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const rootRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const [open, setOpen] = useState(false)
  const [permissions, setPermissions] = useState<AgentPermissions | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [savingPermission, setSavingPermission] = useState<keyof AgentPermissions | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const loadPermissions = async (): Promise<void> => {
    setLoading(true)
    setLoadFailed(false)
    const result = await callIpc<unknown>(
      'settings.getAgentPermissions',
      () => window.api.settings.getAgentPermissions(),
      null
    )
    if (!mountedRef.current) return
    setLoading(false)
    if (!isAgentPermissions(result)) {
      setPermissions(null)
      setLoadFailed(true)
      toast.error(t('terminal.permissions.loadFailed'))
      return
    }
    setPermissions(result)
  }

  const toggleMenu = (): void => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen && permissions === null && !loading) void loadPermissions()
  }

  const updatePermission = async (key: keyof AgentPermissions, allowed: boolean): Promise<void> => {
    if (!permissions || savingPermission) return
    const next = { ...permissions, [key]: allowed }
    setSavingPermission(key)
    const result = await callIpc(
      'settings.setAgentPermissions',
      () => window.api.settings.setAgentPermissions(next),
      { ok: false }
    )
    if (!mountedRef.current) return
    setSavingPermission(null)
    if (result.ok && isAgentPermissions(result.permissions ?? next)) {
      setPermissions(result.permissions ?? next)
      toast.success(t('terminal.permissions.saved'))
      return
    }
    toast.error(result.error ? errorMessage(result.error) : t('terminal.permissions.saveFailed'))
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleMenu}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-6 cursor-pointer items-center gap-1 border px-2 text-[12px] ${
          open
            ? 'border-accent bg-canvas-soft text-text'
            : 'border-border bg-canvas-soft text-text-muted hover:text-text'
        }`}
      >
        <ShieldIcon />
        <span>{t('terminal.permissions.trigger')}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-labelledby="agent-permissions-title"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-80 border border-border bg-canvas-raised p-3 shadow-pop"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 id="agent-permissions-title" className="text-[13px] font-semibold text-text">
                {t('terminal.permissions.title')}
              </h2>
              <p className="mt-0.5 text-[11px] text-text-faint">{t('terminal.permissions.intro')}</p>
            </div>
            {savingPermission && <Spinner className="h-4 w-4 shrink-0 text-accent" />}
          </div>

          <div className="mt-3 border-t border-border-soft pt-3">
            {loading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : loadFailed ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-danger">{t('terminal.permissions.loadFailed')}</span>
                <Button size="sm" onClick={() => void loadPermissions()}>
                  {t('terminal.permissions.retry')}
                </Button>
              </div>
            ) : permissions ? (
              <div className="flex flex-col gap-3">
                <Checkbox
                  id="agent-auto-complete-fields"
                  label={t('terminal.permissions.allowAutoCompleteFields')}
                  hint={t('terminal.permissions.allowAutoCompleteFieldsHint')}
                  checked={permissions.autoCompleteFields}
                  onChange={(allowed) => void updatePermission('autoCompleteFields', allowed)}
                  disabled={savingPermission !== null}
                />
                <Checkbox
                  id="agent-auto-upload-documents"
                  label={t('terminal.permissions.allowAutoUploadDocuments')}
                  hint={t('terminal.permissions.allowAutoUploadDocumentsHint')}
                  checked={permissions.autoUploadDocuments}
                  onChange={(allowed) => void updatePermission('autoUploadDocuments', allowed)}
                  disabled={savingPermission !== null}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function ShieldIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 13 3v4.2c0 3.2-2 5.8-5 7.3-3-1.5-5-4.1-5-7.3V3l5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={open ? 'm2.5 7.5 3.5-3 3.5 3' : 'm2.5 4.5 3.5 3 3.5-3'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
