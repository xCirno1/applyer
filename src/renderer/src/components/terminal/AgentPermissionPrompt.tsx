import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentPermission,
  AgentPermissionDecision,
  AgentPermissionRequest
} from '@shared/types/agentPermissions'
import { isAgentPermissionRequest } from '@shared/types/agentPermissions'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Callout from '../ui/Callout'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { useToast } from '../ui/useToast'

/**
 * Global queue for agent permission requests. The subscription is installed
 * before the pending snapshot is loaded, then both paths de-duplicate by id,
 * so a request arriving during startup is neither missed nor shown twice.
 */
export default function AgentPermissionPrompt(): ReactElement | null {
  const { t } = useTranslation('workspace')
  const toast = useToast()
  const toastRef = useRef(toast)
  const errorMessage = useErrorMessage()
  const resolvedRequestIds = useRef(new Set<string>())
  const [pending, setPending] = useState<AgentPermissionRequest[]>([])
  const [busy, setBusy] = useState<AgentPermissionDecision | null>(null)
  const current = pending[0] ?? null

  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  useEffect(() => {
    let mounted = true
    const addRequest = (value: unknown): void => {
      if (!isAgentPermissionRequest(value)) {
        console.error('Ignored malformed agent permission request', value)
        return
      }
      if (resolvedRequestIds.current.has(value.requestId)) return
      setPending((requests) =>
        requests.some(({ requestId }) => requestId === value.requestId) ? requests : [...requests, value]
      )
    }
    const removeRequest = (value: unknown): void => {
      const requestId =
        value && typeof value === 'object' && typeof (value as { requestId?: unknown }).requestId === 'string'
          ? (value as { requestId: string }).requestId
          : null
      if (!requestId) {
        console.error('Ignored malformed resolved permission request', value)
        return
      }
      resolvedRequestIds.current.add(requestId)
      setPending((requests) => requests.filter((request) => request.requestId !== requestId))
    }

    const offRequested = window.api.agentPermissions.onRequested(addRequest)
    const offResolved = window.api.agentPermissions.onResolved(removeRequest)
    void callIpc<unknown>('agentPermissions.listPending', () => window.api.agentPermissions.listPending(), null).then(
      (result) => {
        if (!mounted) return
        if (!Array.isArray(result) || !result.every(isAgentPermissionRequest)) {
          toastRef.current.error(t('permissionPrompt.loadFailed'))
          return
        }
        for (const request of result) addRequest(request)
      }
    )

    return () => {
      mounted = false
      offRequested()
      offResolved()
    }
  }, [t])

  if (!current) return null

  const respond = async (decision: AgentPermissionDecision): Promise<void> => {
    if (busy) return
    setBusy(decision)
    const result = await callIpc(
      'agentPermissions.respond',
      () => window.api.agentPermissions.respond(current.requestId, decision),
      { ok: false }
    )
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error ? errorMessage(result.error) : t('permissionPrompt.respondFailed'))
      return
    }
    setPending((requests) => requests.filter((request) => request.requestId !== current.requestId))
    if (decision === 'allow_always') toast.success(t('permissionPrompt.saved'))
  }

  const permissionLabel = (permission: AgentPermission): string =>
    permission === 'autoCompleteFields'
      ? t('permissionPrompt.completeFields')
      : t('permissionPrompt.uploadDocuments')

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) void respond('deny')
      }}
      title={t('permissionPrompt.title')}
      width="max-w-md"
    >
      <div className="flex flex-col gap-3">
        <Callout tone="warning" title={t('permissionPrompt.agentWantsAccess')}>
          {t('permissionPrompt.context', { title: current.jobTitle, company: current.company })}
        </Callout>

        <div className="border-y border-border-soft py-2">
          <p className="text-[12px] font-medium text-text">{t('permissionPrompt.requested')}</p>
          <ul className="mt-1 list-disc pl-5 text-[12px] text-text-muted">
            {current.permissions.map((permission) => (
              <li key={permission}>{permissionLabel(permission)}</li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-text-faint">{t('permissionPrompt.explanation')}</p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            loading={busy === 'deny'}
            onClick={() => void respond('deny')}
          >
            {t('permissionPrompt.deny')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            loading={busy === 'allow_always'}
            onClick={() => void respond('allow_always')}
          >
            {t('permissionPrompt.allowAlways')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null}
            loading={busy === 'allow_once'}
            onClick={() => void respond('allow_once')}
          >
            {t('permissionPrompt.allowOnce')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
