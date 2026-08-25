import { useEffect, useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Select from '../../components/ui/Select'
import TextField from '../../components/ui/TextField'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { CLI_LABELS } from '../../components/settings/mcpCliLabels'
import McpCliCard from '../../components/settings/McpCliCard'
import type { AutoStartCommand, McpConfigDetection } from '@shared/types/ipcEvents'

type Preset = 'off' | 'claude' | 'codex' | 'custom'

function presetForCommand(command: string): Preset {
  if (command === '') return 'off'
  if (command === 'claude') return 'claude'
  if (command === 'codex') return 'codex'
  return 'custom'
}

export default function AgentSection(): ReactElement {
  const [savedCommand, setSavedCommand] = useState<AutoStartCommand | null>(null)
  const [preset, setPreset] = useState<Preset>('off')
  const [customCommand, setCustomCommand] = useState('')
  const [saving, setSaving] = useState(false)
  const [detections, setDetections] = useState<McpConfigDetection[] | null>(null)
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  useEffect(() => {
    window.api.settings.getAutoStartCommand().then((command) => {
      setSavedCommand(command)
      const derived = presetForCommand(command)
      setPreset(derived)
      if (derived === 'custom') setCustomCommand(command)
    })
    window.api.onboarding.detectMcpConfigs().then(setDetections)
  }, [])

  const save = async (command: string): Promise<void> => {
    setSaving(true)
    const result = await window.api.settings.setAutoStartCommand(command)
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
    // 'custom' just reveals the text field below — nothing to save until submit.
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
    <div className="flex max-w-xl flex-col gap-5">
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
    </div>
  )
}
