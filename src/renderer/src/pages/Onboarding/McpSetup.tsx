import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import Skeleton from '../../components/ui/Skeleton'
import Tooltip from '../../components/ui/Tooltip'
import McpCliCard from '../../components/settings/McpCliCard'
import OnboardingShell from '../../components/onboarding/OnboardingShell'
import type { McpConfigDetection } from '@shared/types/ipcEvents'

type Detections = { status: 'loading' } | { status: 'ready'; list: McpConfigDetection[] } | { status: 'failed' }

export default function McpSetup({
  onNext,
  onBack
}: {
  onNext: () => void
  onBack: () => void
}): ReactElement {
  const { t } = useTranslation(['onboarding', 'settings'])
  const [detections, setDetections] = useState<Detections>({ status: 'loading' })

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
      <div className="flex flex-col gap-3">
        <Callout>
          {t('mcp.explainerBefore')}{' '}
          <Tooltip label={t('welcome.mcpTooltip')}>
            <span className="cursor-help border-b border-dotted border-text-faint text-text">
              {t('welcome.mcpTerm')}
            </span>
          </Tooltip>
          {t('mcp.explainerAfter')}
        </Callout>

        {detections.status === 'loading' && (
          <div className="flex flex-col gap-2" aria-label={t('agent.detecting', { ns: 'settings' })}>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {detections.status === 'failed' && (
          <Callout tone="danger">{t('mcp.detectFailed')}</Callout>
        )}

        {detections.status === 'ready' && detections.list.length === 0 && (
          <Callout tone="warning">{t('mcp.noneDetected')}</Callout>
        )}

        {detections.status === 'ready' &&
          detections.list.map((d) => <McpCliCard key={d.cli} detection={d} />)}

        <p className="text-[11px] text-text-faint">{t('mcp.optionalNote')}</p>
      </div>
    </OnboardingShell>
  )
}
