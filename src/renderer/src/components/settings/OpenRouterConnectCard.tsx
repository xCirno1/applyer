import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Callout from '../ui/Callout'
import Checkbox from '../ui/Checkbox'
import ConfirmDialog from '../ui/ConfirmDialog'
import CopyBlock from '../ui/CopyBlock'
import Skeleton from '../ui/Skeleton'
import Spinner from '../ui/Spinner'
import Tag from '../ui/Tag'
import TextField from '../ui/TextField'
import { useToast } from '../ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { appError, type AppError } from '@shared/types/errorCodes'
import type { OpenRouterAuthStatus, OpenRouterConnection, OpenRouterKeyInfo } from '@shared/types/openrouter'
import {
  authUiPhase,
  canStartConnect,
  canSubmitAuthCode,
  formatUsd,
  remainingCredits
} from './openRouterConnectLogic'

const DEFAULT_CONNECTION: OpenRouterConnection = { connected: false, keychainAvailable: true }

/** callIpc's fallback for a rejected bridge call, same shape and reasoning as resumesStore's `BRIDGE_FAILURE`. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

/** Only http(s) reaches `shell.openExternal` (see `main/window.ts`'s window-open handler); both links here always start that way. */
function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

interface OpenRouterConnectCardProps {
  /** Told whenever the loaded connection's `connected` flag changes, so a caller (the onboarding step) can warn separately that chat needs it. */
  onConnectedChange?: (connected: boolean) => void
}

/**
 * The OpenRouter connect/connected card shared by Settings > Agent and the
 * onboarding agent step. Owns the whole auth lifecycle itself (loading the
 * connection, subscribing to the pushed `OpenRouterAuthStatus`, starting/
 * cancelling/submitting the OAuth exchange, refreshing and disconnecting)
 * so both call sites can drop it in without re-plumbing any of it.
 *
 * The auth flow's own UI (the URL, the paste field, the spinner) replaces
 * this card's body while `authUiPhase` reports `'waiting'`/`'exchanging'`;
 * `'connected'` isn't rendered as a phase of its own, it triggers a
 * connection reload and control returns to the ordinary connected view.
 * `'failed'` also falls back to the ordinary (disconnected) view, with the
 * error shown inline above the Connect button as well as toasted once:
 * getting stuck on a dead-end "failed" screen would leave no way back to
 * the button that retries.
 */
export default function OpenRouterConnectCard({ onConnectedChange }: OpenRouterConnectCardProps): ReactElement {
  const { t, i18n } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const locale = i18n.language

  const [connection, setConnection] = useState<OpenRouterConnection | null>(null)
  const [authStatus, setAuthStatus] = useState<OpenRouterAuthStatus>({ state: 'idle' })
  const [allowPlaintextKey, setAllowPlaintextKey] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [submittingCode, setSubmittingCode] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)

  const reloadConnection = async (): Promise<void> => {
    const next = await callIpc(
      'openrouter.getConnection',
      () => window.api.openrouter.getConnection(),
      connection ?? DEFAULT_CONNECTION
    )
    setConnection(next)
  }

  useEffect(() => {
    // Standard fetch-on-mount; reloadConnection is called explicitly
    // elsewhere as actions complete, not on any other dependency here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadConnection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.api.openrouter.onAuthStatus((status) => {
      setAuthStatus(status)
      if (status.state === 'connected') void reloadConnection()
      if (status.state === 'failed') toast.error(errorMessage(status.error))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A rejected key is "connected" to the card (there is something to
  // disconnect) but not to whoever asked: onboarding must not move on
  // with a key OpenRouter refuses.
  useEffect(() => {
    if (connection) onConnectedChange?.(connection.connected && !connection.keyRejected)
  }, [connection, onConnectedChange])

  const handleConnect = async (): Promise<void> => {
    setConnecting(true)
    const result = await callIpc(
      'openrouter.startAuth',
      () => window.api.openrouter.startAuth({ allowPlaintextKey }),
      BRIDGE_FAILURE
    )
    setConnecting(false)
    if (result.ok) {
      // Optimistic: renders the URL/paste UI immediately rather than waiting
      // on the push, which normally arrives right behind this but isn't
      // guaranteed to beat the next render.
      setAuthStatus({ state: 'waiting', authUrl: result.authUrl, startedAt: new Date().toISOString() })
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('agent.connect.startFailed'))
    }
  }

  const handleCancel = async (): Promise<void> => {
    setCancelling(true)
    await callIpc('openrouter.cancelAuth', () => window.api.openrouter.cancelAuth(), { ok: false })
    setCancelling(false)
    setPasteValue('')
    setAuthStatus({ state: 'idle' })
  }

  const handleSubmitCode = async (): Promise<void> => {
    if (!canSubmitAuthCode(pasteValue)) return
    setSubmittingCode(true)
    const result = await callIpc(
      'openrouter.submitAuthCode',
      () => window.api.openrouter.submitAuthCode(pasteValue),
      BRIDGE_FAILURE
    )
    setSubmittingCode(false)
    if (result.ok) {
      setPasteValue('')
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('agent.connect.invalidCode'))
    }
  }

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    const next = await callIpc(
      'openrouter.refreshConnection',
      () => window.api.openrouter.refreshConnection(),
      connection ?? DEFAULT_CONNECTION
    )
    setRefreshing(false)
    setConnection(next)
  }

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true)
    const result = await callIpc(
      'openrouter.disconnect',
      () => window.api.openrouter.disconnect(),
      BRIDGE_FAILURE
    )
    setDisconnecting(false)
    setConfirmDisconnectOpen(false)
    if (result.ok) {
      toast.success(t('agent.connect.disconnected'))
      await reloadConnection()
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('agent.connect.disconnectFailed'))
    }
  }

  if (connection === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-7 w-32" />
      </div>
    )
  }

  const phase = authUiPhase(authStatus)

  if (phase.phase === 'waiting' || phase.phase === 'exchanging') {
    return (
      <div className="flex flex-col gap-3">
        {phase.phase === 'waiting' && (
          <>
            <CopyBlock text={phase.authUrl} variant="wrap" caption={t('agent.connect.authUrlCaption')} />
            <p className="text-[12px] text-text-muted">{t('agent.connect.browserNote')}</p>
          </>
        )}
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <Spinner />
          <span>{phase.phase === 'exchanging' ? t('agent.connect.exchanging') : t('agent.connect.waiting')}</span>
        </div>
        {phase.phase === 'waiting' && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={t('agent.connect.pasteLabel')}
                placeholder={t('agent.connect.pastePlaceholder')}
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                disabled={submittingCode}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitCode()
                }}
              />
            </div>
            <Button onClick={handleSubmitCode} loading={submittingCode} disabled={!canSubmitAuthCode(pasteValue)}>
              {t('agent.connect.submitCode')}
            </Button>
          </div>
        )}
        <div>
          <Button variant="ghost" onClick={handleCancel} loading={cancelling}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
        </div>
      </div>
    )
  }

  const authError = phase.phase === 'failed' ? phase.error : null

  if (!connection.connected) {
    return (
      <div className="flex flex-col gap-3">
        {authError && <Callout tone="danger">{errorMessage(authError)}</Callout>}
        {!connection.keychainAvailable && (
          <>
            <Callout tone="warning" title={t('agent.connect.noKeychainTitle')}>
              {t('agent.connect.noKeychainBody')}
            </Callout>
            <Checkbox
              label={t('agent.connect.allowPlaintext')}
              checked={allowPlaintextKey}
              onChange={setAllowPlaintextKey}
            />
          </>
        )}
        <div>
          <Button
            variant="primary"
            onClick={handleConnect}
            loading={connecting}
            disabled={!canStartConnect(connection, allowPlaintextKey)}
          >
            {t('agent.connect.connect')}
          </Button>
        </div>
      </div>
    )
  }

  const keyInfo: OpenRouterKeyInfo | null = connection.keyInfo
  const credits = connection.credits

  if (connection.keyRejected) {
    return (
      <div className="flex flex-col gap-3">
        <Callout tone="danger" title={t('agent.connect.keyRejectedTitle')}>
          {t('agent.connect.keyRejectedBody')}
        </Callout>
        {authError && <Callout tone="danger">{errorMessage(authError)}</Callout>}
        {!connection.keychainAvailable && (
          <Checkbox label={t('agent.connect.allowPlaintext')} checked={allowPlaintextKey} onChange={setAllowPlaintextKey} />
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={handleConnect}
            loading={connecting}
            disabled={!canStartConnect(connection, allowPlaintextKey)}
          >
            {t('agent.connect.reconnect')}
          </Button>
          <Button variant="secondary" onClick={handleRefresh} loading={refreshing}>
            {t('agent.connect.refresh')}
          </Button>
          <Button variant="danger" onClick={() => setConfirmDisconnectOpen(true)}>
            {t('agent.connect.disconnect')}
          </Button>
        </div>
        <ConfirmDialog
          open={confirmDisconnectOpen}
          title={t('agent.connect.disconnectConfirmTitle')}
          message={t('agent.connect.disconnectConfirmMessage')}
          confirmLabel={t('agent.connect.disconnect')}
          danger
          loading={disconnecting}
          onConfirm={handleDisconnect}
          onCancel={() => setConfirmDisconnectOpen(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {connection.refreshError && <Callout tone="warning">{errorMessage(connection.refreshError)}</Callout>}
      <div className="flex flex-col gap-2 border border-border-soft p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-text">{keyInfo?.label ?? t('agent.connect.unlabeledKey')}</span>
          {connection.storedPlaintext && <Tag tone="warning" label={t('agent.connect.plaintextTag')} />}
          {keyInfo?.isFreeTier && <Tag tone="neutral" label={t('agent.connect.freeTierTag')} />}
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <Stat label={t('agent.connect.usage')} value={formatUsd(keyInfo?.usage ?? 0, locale)} />
          <Stat
            label={t('agent.connect.limit')}
            value={keyInfo?.limit === null || keyInfo?.limit === undefined ? t('agent.connect.noLimit') : formatUsd(keyInfo.limit, locale)}
          />
          {credits && (
            <Stat
              label={t('agent.connect.creditsRemaining')}
              value={formatUsd(remainingCredits(credits.totalCredits, credits.totalUsage), locale)}
            />
          )}
        </dl>
        {keyInfo && (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => openExternal(`https://openrouter.ai/keys/${keyInfo.keyHash}`)}
              className="cursor-pointer text-[12px] text-accent hover:underline"
            >
              {t('agent.connect.manageKey')}
            </button>
            <button
              type="button"
              onClick={() => openExternal(`https://openrouter.ai/logs?api_key_hash=${keyInfo.keyHash}`)}
              className="cursor-pointer text-[12px] text-accent hover:underline"
            >
              {t('agent.connect.usageLogs')}
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleRefresh} loading={refreshing}>
          {t('agent.connect.refresh')}
        </Button>
        <Button variant="danger" onClick={() => setConfirmDisconnectOpen(true)}>
          {t('agent.connect.disconnect')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDisconnectOpen}
        title={t('agent.connect.disconnectConfirmTitle')}
        message={t('agent.connect.disconnectConfirmMessage')}
        confirmLabel={t('agent.connect.disconnect')}
        danger
        loading={disconnecting}
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmDisconnectOpen(false)}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-text-faint">{label}</dt>
      <dd className="font-medium text-text">{value}</dd>
    </div>
  )
}
