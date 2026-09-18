import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentMode } from '@shared/types/agentMode'

const MODES: readonly AgentMode[] = ['cli', 'openrouter']

interface AgentModeChoiceProps {
  value: AgentMode
  onChange: (mode: AgentMode) => void
  disabled?: boolean
}

/**
 * The exclusive CLI-vs-OpenRouter choice, shared by Settings > Agent and the
 * onboarding agent step (so a user who already picked one in onboarding
 * sees the exact same control later). Two side-by-side panels, plain radio
 * semantics (`role="radiogroup"`/`role="radio"`, roving tabindex, arrow keys
 * move the selection) so it reads as one control rather than two buttons.
 *
 * Selection is a full-strength `border-accent` seam with no fill change,
 * unlike `StorageModeCard`, which fills `bg-canvas-soft` when selected,
 * because this sits directly above the active mode's own panel, and a
 * filled selected card there would visually compete with the content below
 * it rather than just marking which side is active.
 */
export default function AgentModeChoice({ value, onChange, disabled = false }: AgentModeChoiceProps): ReactElement {
  const { t } = useTranslation('settings')
  const rootRef = useRef<HTMLDivElement>(null)

  const focusMode = (mode: AgentMode): void => {
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const index = MODES.indexOf(value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = MODES[(index + 1) % MODES.length]!
      onChange(next)
      focusMode(next)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = MODES[(index - 1 + MODES.length) % MODES.length]!
      onChange(next)
      focusMode(next)
    }
  }

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={t('agent.modeChoice.legend')}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-2 sm:flex-row"
    >
      {MODES.map((mode) => (
        <ModeOption
          key={mode}
          mode={mode}
          selected={value === mode}
          disabled={disabled}
          onSelect={() => onChange(mode)}
        />
      ))}
    </div>
  )
}

function ModeOption({
  mode,
  selected,
  disabled,
  onSelect
}: {
  mode: AgentMode
  selected: boolean
  disabled: boolean
  onSelect: () => void
}): ReactElement {
  const { t } = useTranslation('settings')

  return (
    <button
      type="button"
      data-mode={mode}
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      className={`flex flex-1 flex-col gap-1 border bg-canvas-raised p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected ? 'border-accent' : 'border-border hover:border-text-faint'
      } ${disabled ? '' : 'cursor-pointer'}`}
    >
      <span className="text-[13px] font-medium text-text">{t(`agent.modeChoice.${mode}.title`)}</span>
      <p className="text-[12px] text-text-muted">{t(`agent.modeChoice.${mode}.description`)}</p>
      <p className="text-[11px] text-text-faint">{t(`agent.modeChoice.${mode}.needs`)}</p>
    </button>
  )
}
