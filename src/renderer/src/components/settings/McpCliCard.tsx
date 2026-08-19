import { useEffect, useState, type ReactElement } from 'react'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Dropdown from '../ui/Dropdown'
import McpConfigSnippet from '../onboarding/McpConfigSnippet'
import { useToast } from '../ui/useToast'
import { CLI_LABELS } from './mcpCliLabels'
import type { McpConfigDetection, McpScope } from '@shared/types/ipcEvents'

const SCOPE_OPTIONS: { value: McpScope; label: string }[] = [
  { value: 'user', label: 'All projects (global)' },
  { value: 'workspace', label: 'This workspace only' }
]

const SCOPE_LABELS: Record<McpScope, string> = {
  user: 'all projects (global)',
  workspace: 'this workspace only'
}

/** Used by both onboarding's McpSetup step and the Settings > Connections section. */
export default function McpCliCard({ detection }: { detection: McpConfigDetection }): ReactElement {
  const toast = useToast()
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
        `${CLI_LABELS[detection.cli]} configured for ${SCOPE_LABELS[scope]}. Restart ${detection.cli} in any open terminal for it to take effect.`
      )
    } else {
      toast.error(result.error ?? 'Auto-configure failed — use the snippet below instead.')
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
        `${CLI_LABELS[detection.cli]} isn't configured for ${SCOPE_LABELS[scope]} yet — click Auto-configure above, or add the snippet manually, first.`
      )
      return
    }

    const result = await window.api.onboarding.verifyMcpConnection()
    setVerifying(false)
    setVerifyResult(
      result.success ? `Connected — ${result.tools?.length ?? 0} tools available.` : (result.error ?? 'Failed.')
    )
  }

  return (
    <div className="flex flex-col gap-2 border border-border-soft bg-canvas-raised p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text">{CLI_LABELS[detection.cli]}</span>
        {!detection.exists && <span className="text-[11px] text-text-faint">Not detected on this system</span>}
        {configured && <span className="text-[11px] text-success">Configured</span>}
      </div>

      {detection.supportsWorkspaceScope ? (
        <Dropdown
          size="sm"
          className="w-44"
          ariaLabel={`${CLI_LABELS[detection.cli]} config scope`}
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={(v) => setScope(v as McpScope)}
        />
      ) : (
        <span className="text-[11px] text-text-faint">
          {CLI_LABELS[detection.cli]} only supports global configuration.
        </span>
      )}

      <McpConfigSnippet snippet={snippet} />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setConfirmOpen(true)} loading={configuring} disabled={!detection.exists}>
          Auto-configure
        </Button>
        <Button size="sm" variant="ghost" onClick={handleVerify} loading={verifying}>
          Verify connection
        </Button>
        {verifyResult && <span className="text-[11px] text-text-muted">{verifyResult}</span>}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Configure ${CLI_LABELS[detection.cli]}`}
        message={`This will edit ${CLI_LABELS[detection.cli]}'s own configuration to add Applyer as an MCP server for ${SCOPE_LABELS[scope]} (backing up the original first). Continue?`}
        confirmLabel="Configure"
        onConfirm={handleAutoConfigure}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
