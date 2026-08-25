import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Dropdown from '../ui/Dropdown'
import McpConfigSnippet from '../onboarding/McpConfigSnippet'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { CLI_LABELS } from './mcpCliLabels'
import type { McpConfigDetection, McpScope } from '@shared/types/ipcEvents'

// Two forms per scope: a standalone dropdown option, and a lowercase form
// that reads correctly mid-sentence ("configured for all projects (global)").
const SCOPE_OPTION_KEYS = {
  user: 'mcp.scopeUser',
  workspace: 'mcp.scopeWorkspace'
} as const satisfies Record<McpScope, string>

const SCOPE_INLINE_KEYS = {
  user: 'mcp.scopeUserInline',
  workspace: 'mcp.scopeWorkspaceInline'
} as const satisfies Record<McpScope, string>

/** Used by both onboarding's McpSetup step and the Settings > Agent section's Connections subsection. */
export default function McpCliCard({ detection }: { detection: McpConfigDetection }): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [scope, setScope] = useState<McpScope>('user')
  const [snippet, setSnippet] = useState('')
  const [configuring, setConfiguring] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [configuredScopes, setConfiguredScopes] = useState(detection.configuredScopes)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<string | null>(null)

  const configured = configuredScopes.includes(scope)

  useEffect(() => {
    window.api.onboarding.getMcpSnippet(detection.cli, scope).then(setSnippet)
  }, [detection.cli, scope])

  const handleAutoConfigure = async (): Promise<void> => {
    setConfirmOpen(false)
    setConfiguring(true)
    const result = await window.api.onboarding.autoConfigureMcp(detection.cli, scope)
    setConfiguring(false)
    if (result.success) {
      setConfiguredScopes((prev) => (prev.includes(scope) ? prev : [...prev, scope]))
      toast.success(
        t('mcp.configuredToast', {
          cli: CLI_LABELS[detection.cli],
          scope: t(SCOPE_INLINE_KEYS[scope])
        })
      )
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('mcp.autoConfigureFailed'))
    }
  }

  const handleVerify = async (): Promise<void> => {
    setVerifying(true)
    setVerifyResult(null)

    // Re-check the CLI's own config fresh rather than trusting local state — it may have
    // been configured manually (via the snippet) or in a previous app session.
    const freshDetections = await window.api.onboarding.detectMcpConfigs()
    const freshScopes = freshDetections.find((d) => d.cli === detection.cli)?.configuredScopes ?? []
    setConfiguredScopes(freshScopes)

    if (!freshScopes.includes(scope)) {
      setVerifying(false)
      setVerifyResult(
        t('mcp.notConfiguredYet', {
          cli: CLI_LABELS[detection.cli],
          scope: t(SCOPE_INLINE_KEYS[scope])
        })
      )
      return
    }

    const result = await window.api.onboarding.verifyMcpConnection()
    setVerifying(false)
    setVerifyResult(
      result.success
        ? t('mcp.connectedTools', { count: result.tools?.length ?? 0 })
        : (result.error ?? t('mcp.verifyFailed'))
    )
  }

  return (
    <div className="flex flex-col gap-2 border border-border-soft bg-canvas-raised p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text">{CLI_LABELS[detection.cli]}</span>
        {!detection.exists && <span className="text-[11px] text-text-faint">{t('mcp.notDetected')}</span>}
        {configured && <span className="text-[11px] text-success">{t('mcp.configured')}</span>}
      </div>

      {detection.supportsWorkspaceScope ? (
        <Dropdown
          size="sm"
          className="w-44"
          ariaLabel={t('mcp.scopeAriaLabel', { cli: CLI_LABELS[detection.cli] })}
          options={(['user', 'workspace'] as McpScope[]).map((value) => ({
            value,
            label: t(SCOPE_OPTION_KEYS[value])
          }))}
          value={scope}
          onChange={(v) => setScope(v as McpScope)}
        />
      ) : (
        <span className="text-[11px] text-text-faint">
          {t('mcp.globalOnly', { cli: CLI_LABELS[detection.cli] })}
        </span>
      )}

      <McpConfigSnippet snippet={snippet} />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setConfirmOpen(true)} loading={configuring} disabled={!detection.exists}>
          {t('mcp.autoConfigure')}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleVerify} loading={verifying}>
          {t('mcp.verify')}
        </Button>
        {verifyResult && <span className="text-[11px] text-text-muted">{verifyResult}</span>}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('mcp.configureTitle', { cli: CLI_LABELS[detection.cli] })}
        message={t('mcp.configureMessage', {
          cli: CLI_LABELS[detection.cli],
          scope: t(SCOPE_INLINE_KEYS[scope])
        })}
        confirmLabel={t('mcp.configureConfirm')}
        onConfirm={handleAutoConfigure}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
