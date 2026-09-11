import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export default function EditableProfileField({
  label,
  value,
  hint,
  editing,
  onEdit,
  children
}: {
  label: string
  value: string
  hint?: string
  editing: boolean
  onEdit: () => void
  children: ReactNode
}): ReactElement {
  const { t } = useTranslation('common')

  if (editing) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">{label}</span>
        {children}
        {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
      </label>
    )
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={t('profile.editField', { field: label })}
      className="group flex w-full flex-col items-start gap-1 py-1 text-left outline-none hover:text-text focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <span className="flex items-start gap-1.5 text-[13px]">
        <span className={value ? 'whitespace-pre-wrap text-text' : 'text-text-faint'}>{value || t('profile.notSet')}</span>
        <PencilIcon />
      </span>
      {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
    </button>
  )
}

function PencilIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
