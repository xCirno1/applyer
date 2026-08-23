import { useEffect, useState, type ReactElement } from 'react'
import Select from '../../components/ui/Select'
import TextField from '../../components/ui/TextField'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { CLI_LABELS } from '../../components/settings/mcpCliLabels'
import McpCliCard from '../../components/settings/McpCliCard'
import type { AutoStartCommand, McpConfigDetection } from '@shared/types/ipcEvents'

type Preset = 'off' | 'claude' | 'codex' | 'custom'

const PRESET_OPTIONS = [
  { value: 'off', label: 'Off — start a plain shell' },
  { value: 'claude', label: CLI_LABELS.claude },
  { value: 'codex', label: CLI_LABELS.codex },
  { value: 'custom', label: 'Custom command…' }
]

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
  const toast = useToast()

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
        finalCommand ? `The embedded terminal will now auto-run: ${finalCommand}` : 'The embedded terminal will open to a plain shell.'
      )
    } else {
      toast.error(result.error ?? 'Failed to update the setting.')
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

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Auto-start command</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            Automatically type a command into every new terminal session Applyer opens — handy for dropping straight
            into an agent CLI so it's ready to use the <code className="text-text">applyer</code> MCP tools without
            typing the launch command yourself. Pick a preset, or enter any other command (a different agent CLI, a
            launcher script, etc). This only affects new sessions.
          </p>
        </div>

        <Select
          label="Auto-start command"
          options={PRESET_OPTIONS}
          value={preset}
          onChange={handlePresetChange}
          disabled={savedCommand === null || saving}
        />

        {preset === 'custom' && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Command"
                placeholder="e.g. aider --model gpt-5, opencode, ./start-agent.sh"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomSubmit()
                }}
                disabled={savedCommand === null || saving}
              />
            </div>
            <Button onClick={handleCustomSubmit} loading={saving} disabled={!customDirty}>
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-5">
        <div>
          <h2 className="text-[13px] font-semibold text-text">Connections</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            Applyer exposes tools (search, queue, fill applications, etc.) over MCP — connect one or more agent CLIs
            here.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {detections === null && <p className="text-[12px] text-text-faint">Detecting installed CLIs…</p>}
          {detections?.map((d) => (
            <McpCliCard key={d.cli} detection={d} />
          ))}
        </div>
      </div>
    </div>
  )
}
