import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdditionalInformation } from '@shared/types/profile'
import Button from '../ui/Button'

export default function AdditionalInformationEditor({
  value,
  onChange
}: {
  value: AdditionalInformation[]
  onChange: (value: AdditionalInformation[]) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const update = (index: number, field: keyof AdditionalInformation, next: string): void => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: next } : item)))
  }

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-[12px] font-medium text-text-muted">{t('profile.additionalInformation')}</h2>
        <p className="text-[12px] text-text-faint">{t('profile.additionalInformationHint')}</p>
      </div>
      {value.map((item, index) => (
        <div key={index} className="flex flex-col gap-2 border border-border-soft p-2">
          {editingIndex === index ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-text-muted">{t('profile.question')}</span>
                <input
                  value={item.question}
                  onChange={(event) => update(index, 'question', event.target.value)}
                  maxLength={500}
                  className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-text-muted">{t('profile.answer')}</span>
                <textarea
                  value={item.answer}
                  onChange={(event) => update(index, 'answer', event.target.value)}
                  maxLength={5000}
                  rows={3}
                  className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditingIndex(null)}>
                  {t('actions.done')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    onChange(value.filter((_, itemIndex) => itemIndex !== index))
                    setEditingIndex(null)
                  }}
                >
                  {t('actions.remove')}
                </Button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditingIndex(index)}
              aria-label={t('profile.editAdditionalInformation', { question: item.question || t('profile.notSet') })}
              className="group flex flex-col gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <div className="flex items-start gap-1.5">
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-[12px] font-medium text-text-muted">{t('profile.question')}</span>
                  <span className={item.question ? 'text-[13px] text-text' : 'text-[13px] text-text-faint'}>
                    {item.question || t('profile.notSet')}
                  </span>
                </div>
                <PencilIcon />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-text-muted">{t('profile.answer')}</span>
                <span className={item.answer ? 'whitespace-pre-wrap text-[13px] text-text' : 'text-[13px] text-text-faint'}>
                  {item.answer || t('profile.notSet')}
                </span>
              </div>
            </button>
          )}
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={value.length >= 50}
          onClick={() => {
            onChange([...value, { question: '', answer: '' }])
            setEditingIndex(value.length)
          }}
        >
          {t('profile.addAdditionalInformation')}
        </Button>
      </div>
    </section>
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
