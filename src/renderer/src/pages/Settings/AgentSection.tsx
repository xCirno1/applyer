import { useEffect, useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Select from '../../components/ui/Select'
import TextField from '../../components/ui/TextField'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { CLI_LABELS } from '../../components/settings/mcpCliLabels'
import McpCliCard from '../../components/settings/McpCliCard'
import AgentModeChoice from '../../components/settings/AgentModeChoice'
import OpenRouterConnectCard from '../../components/settings/OpenRouterConnectCard'
import OpenRouterModelSettings from '../../components/settings/OpenRouterModelSettings'
import type { AutoStartCommand, McpConfigDetection } from '@shared/types/ipcEvents'
import { DEFAULT_AGENT_MODE, type AgentMode } from '@shared/types/agentMode'
import { appError, type AppError } from '@shared/types/errorCodes'

type Preset = 'off' | 'claude' | 'codex' | 'custom'

/** callIpc's fallback for a rejected bridge call, same shape and reasoning as resumesStore's `BRIDGE_FAILURE`. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

function presetForCommand(command: string): Preset {
  if (command === '') return 'off'
  if (command === 'claude') return 'claude'
  if (command === 'codex') return 'codex'
  return 'custom'
}

/**
 * Settings > Agent: the CLI-vs-OpenRouter choice up top (shared with
 * onboarding via `AgentModeChoice`), then only the active mode's own setup
 * block below it. Switching modes here is the same `setAgentMode` call the
 * onboarding step makes, so a user who set this up during onboarding and
 * changes their mind later isn't using a second, different code path.
 */
export default function AgentSection(): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const [mode, setMode] = useState<AgentMode | null>(null)
  const [savingMode, setSavingMode] = useState(false)

  useEffect(() => {
    void callIpc('settings.getAgentMode', () => window.api.settings.getAgentMode(), DEFAULT_AGENT_MODE).then(setMode)
  }, [])

  useEffect(() => window.api.settings.onAgentModeChanged(setMode), [])

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
    if (result.ok) {
      toast.success(t('agent.modeChanged'))
    } else {
      setMode(previous)
      toast.error(result.error ? errorMessage(result.error) : t('agent.modeChangeFailed'))
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-text">{t('agent.modeChoice.legend')}</h2>
        <AgentModeChoice
          value={mode ?? DEFAULT_AGENT_MODE}
          onChange={(next) => void handleModeChange(next)}
          disabled={mode === null || savingMode}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border-soft pt-5">
        {mode === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : mode === 'openrouter' ? (
          <OpenRouterAgentBlock />
        ) : (
          <CliAgentBlock />
        )}
      </div>
    </div>
  )
}

function OpenRouterAgentBlock(): ReactElement {
  const { t } = useTranslation('settings')

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-text">{t('agent.connect.title')}</h2>
        <OpenRouterConnectCard />
      </div>
      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <h2 className="text-[13px] font-semibold text-text">{t('agent.models.title')}</h2>
        <OpenRouterModelSettings />
      </div>
    </>
  )
}

function CliAgentBlock(): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [savedCommand, setSavedCommand] = useState<AutoStartCommand | null>(null)
  const [preset, setPreset] = useState<Preset>('off')
  const [customCommand, setCustomCommand] = useState('')
  const [saving, setSaving] = useState(false)
  const [detections, setDetections] = useState<McpConfigDetection[] | null>(null)

  useEffect(() => {
    void callIpc('settings.getAutoStartCommand', () => window.api.settings.getAutoStartCommand(), '').then(
      (command) => {
        setSavedCommand(command)
        const derived = presetForCommand(command)
        setPreset(derived)
        if (derived === 'custom') setCustomCommand(command)
      }
    )
    void callIpc('onboarding.detectMcpConfigs', () => window.api.onboarding.detectMcpConfigs(), []).then(
      setDetections
    )
  }, [])

  const save = async (command: string): Promise<void> => {
    setSaving(true)
    const result = await callIpc(
      'settings.setAutoStartCommand',
      () => window.api.settings.setAutoStartCommand(command),
      { ok: false }
    )
    setSaving(false)
    if (result.ok) {
      const finalCommand = result.command ?? command
      setSavedCommand(finalCommand)
      toast.success(
        finalCommand
          ? t('agent.autoStartSet', { command: finalCommand })
          : t('agent.autoStartCleared')
      )
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('agent.autoStartFailed'))
      if (savedCommand !== null) setPreset(presetForCommand(savedCommand))
    }
  }

  const handlePresetChange = (value: string): void => {
    const next = value as Preset
    setPreset(next)
    if (next === 'off') {
      void save('')
    } else if (next === 'claude' || next === 'codex') {
      void save(next)
    }
    // 'custom' just reveals the text field below; nothing to save until submit.
  }

  const handleCustomSubmit = (): void => {
    void save(customCommand)
  }

  const customDirty = preset === 'custom' && customCommand.trim() !== (savedCommand ?? '')

  // CLI names are proper nouns and stay untranslated.
  const presetOptions = [
    { value: 'off', label: t('agent.presetOff') },
    { value: 'claude', label: CLI_LABELS.claude },
    { value: 'codex', label: CLI_LABELS.codex },
    { value: 'custom', label: t('agent.presetCustom') }
  ]

  return (
    <>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-text">{t('agent.autoStartTitle')}</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            <Trans
              t={t}
              i18nKey="agent.autoStartIntro"
              values={{ tool: 'applyer' }}
              components={{ 1: <code className="text-text" /> }}
            />
          </p>
        </div>

        <Select
          label={t('agent.autoStartTitle')}
          options={presetOptions}
          value={preset}
          onChange={handlePresetChange}
          disabled={savedCommand === null || saving}
        />

        {preset === 'custom' && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={t('agent.commandLabel')}
                placeholder={t('agent.commandPlaceholder')}
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomSubmit()
                }}
                disabled={savedCommand === null || saving}
              />
            </div>
            <Button onClick={handleCustomSubmit} loading={saving} disabled={!customDirty}>
              {t('actions.save', { ns: 'common' })}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-5">
        <div>
          <h2 className="text-[13px] font-semibold text-text">{t('agent.connectionsTitle')}</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">{t('agent.connectionsIntro')}</p>
        </div>
        <div className="flex flex-col gap-2">
          {detections === null && <p className="text-[12px] text-text-faint">{t('agent.detecting')}</p>}
          {detections?.map((d) => (
            <McpCliCard key={d.cli} detection={d} />
          ))}
        </div>
      </div>
    </>
  )
}
