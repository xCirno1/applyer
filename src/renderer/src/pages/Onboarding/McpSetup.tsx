import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import Skeleton from '../../components/ui/Skeleton'
import Tooltip from '../../components/ui/Tooltip'
import McpCliCard from '../../components/settings/McpCliCard'
import AgentModeChoice from '../../components/settings/AgentModeChoice'
import OpenRouterConnectCard from '../../components/settings/OpenRouterConnectCard'
import OpenRouterModelSettings from '../../components/settings/OpenRouterModelSettings'
import OnboardingShell from '../../components/onboarding/OnboardingShell'
import { useToast } from '../../components/ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import type { McpConfigDetection } from '@shared/types/ipcEvents'
import { DEFAULT_AGENT_MODE, type AgentMode } from '@shared/types/agentMode'
import { appError, type AppError } from '@shared/types/errorCodes'

type Detections = { status: 'loading' } | { status: 'ready'; list: McpConfigDetection[] } | { status: 'failed' }

/** callIpc's fallback for a rejected bridge call, same shape and reasoning as resumesStore's `BRIDGE_FAILURE`. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

/**
 * The onboarding agent step: pick CLI vs OpenRouter (`AgentModeChoice`,
 * shared with Settings > Agent so the same control means the same thing in
 * both places), then only that mode's own setup below it. The mode is
 * saved immediately on pick (`setAgentMode`), not deferred to Finish, since
 * Ready's summary line and the app's actual dock both need to already
 * agree with whatever is showing here.
 *
 * Next always stays enabled: a CLI can be installed, or an OpenRouter
 * account connected, later from Settings. Choosing OpenRouter without
 * connecting only adds a warning under the actions, never a gate.
 */
export default function McpSetup({
  onNext,
  onBack
}: {
  onNext: () => void
  onBack: () => void
}): ReactElement {
  const { t } = useTranslation(['onboarding', 'settings'])
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [detections, setDetections] = useState<Detections>({ status: 'loading' })
  const [mode, setMode] = useState<AgentMode | null>(null)
  const [savingMode, setSavingMode] = useState(false)
  const [openRouterConnected, setOpenRouterConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.onboarding
      .detectMcpConfigs()
      .then((list) => {
        if (cancelled) return
        // Detection walks the user's home directory for CLI config files, so
        // a malformed response is a bug rather than user data, but an
        // unexpected shape must still not render as a crashed step.
        if (!Array.isArray(list)) {
          console.error('MCP detection returned a non-list response.')
          setDetections({ status: 'failed' })
          return
        }
        setDetections({ status: 'ready', list })
      })
      .catch((err: unknown) => {
        console.error(`Could not detect installed agent CLIs: ${String(err)}`)
        if (!cancelled) setDetections({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void callIpc('settings.getAgentMode', () => window.api.settings.getAgentMode(), DEFAULT_AGENT_MODE).then(setMode)
  }, [])

  const handleModeChange = async (next: AgentMode): Promise<void> => {
    if (mode === next) return
    const previous = mode
    setMode(next)
    setSavingMode(true)
    const result = await callIpc(
      'settings.setAgentMode',
      () => window.api.settings.setAgentMode(next),
      BRIDGE_FAILURE
    )
    setSavingMode(false)
    if (!result.ok) {
      setMode(previous)
      toast.error(result.error ? errorMessage(result.error) : t('mcp.modeChangeFailed'))
    }
  }

  return (
    <OnboardingShell
      step="agent"
      title={t('mcp.title')}
      subtitle={t('mcp.intro')}
      back={
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
      actions={
        <Button variant="primary" onClick={onNext}>
          {t('nav.next')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Callout>
          {t('mcp.explainerBefore')}{' '}
          <Tooltip label={t('welcome.mcpTooltip')}>
            <span className="cursor-help border-b border-dotted border-text-faint text-text">
              {t('welcome.mcpTerm')}
            </span>
          </Tooltip>
          {t('mcp.explainerAfter')}
        </Callout>

        {mode === null ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <AgentModeChoice value={mode} onChange={(next) => void handleModeChange(next)} disabled={savingMode} />
        )}

        {mode === 'openrouter' ? (
          <div className="flex flex-col gap-4">
            <OpenRouterConnectCard onConnectedChange={setOpenRouterConnected} />
            <OpenRouterModelSettings showToolApproval={false} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {detections.status === 'loading' && (
              <div className="flex flex-col gap-2" aria-label={t('agent.detecting', { ns: 'settings' })}>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}

            {detections.status === 'failed' && <Callout tone="danger">{t('mcp.detectFailed')}</Callout>}

            {detections.status === 'ready' && detections.list.length === 0 && (
              <Callout tone="warning">{t('mcp.noneDetected')}</Callout>
            )}

            {detections.status === 'ready' &&
              detections.list.map((d) => <McpCliCard key={d.cli} detection={d} />)}

            <p className="text-[11px] text-text-faint">{t('mcp.optionalNote')}</p>
          </div>
        )}

        {mode === 'openrouter' && !openRouterConnected && (
          <Callout tone="warning">{t('mcp.openrouterNotConnectedYet')}</Callout>
        )}
      </div>
    </OnboardingShell>
  )
}
