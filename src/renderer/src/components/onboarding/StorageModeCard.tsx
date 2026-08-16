import type { ReactElement } from 'react'

interface StorageModeCardProps {
  title: string
  description: string
  recommended?: boolean
  selected: boolean
  disabled?: boolean
  disabledReason?: string
  onSelect: () => void
}

export default function StorageModeCard({
  title,
  description,
  recommended,
  selected,
  disabled,
  disabledReason,
  onSelect
}: StorageModeCardProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`flex flex-1 flex-col gap-1 border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected ? 'border-accent bg-canvas-soft' : 'border-border bg-canvas-raised hover:border-text-faint'
      } ${disabled ? '' : 'cursor-pointer'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-text">{title}</span>
        {recommended && (
          <span className="border border-success px-1 text-[10px] font-medium text-success">Recommended</span>
        )}
      </div>
      <p className="text-[12px] text-text-muted">{description}</p>
      {disabled && disabledReason && <p className="text-[11px] text-danger">{disabledReason}</p>}
    </button>
  )
}
