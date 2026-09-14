import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RESUME_TEMPLATE_IDS, type ResumeContent, type ResumePageSize, type ResumeTemplateId, type ResumeStyle } from '@shared/types/resume'
import { renderResumeHtml } from '@shared/resume/templates'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import Button from '../ui/Button'
import Tag from '../ui/Tag'
import Modal from '../ui/Modal'
import ResumePreview from './ResumePreview'

/*
 * The Templates tab: one card per built-in template, each a live thumbnail
 * of the master (or the sample content when there is no master yet) so the
 * choice is made on the user's own resume rather than a stock picture.
 * Template names come from the `resumes` namespace rather than the shared
 * template module, which has no locale. The thumbnail is cropped to the
 * top of the page, so clicking it opens the whole document in a modal at
 * full width; the modal carries the same select action so the choice can
 * be made from there.
 */

interface TemplatePickerProps {
  content: ResumeContent | null
  pageSize: ResumePageSize
  style?: ResumeStyle
  selected: ResumeTemplateId
  onSelect: (templateId: ResumeTemplateId) => void
  busy?: boolean
}

export default function TemplatePicker({ content, pageSize, style, selected, onSelect, busy = false }: TemplatePickerProps): ReactElement {
  const { t } = useTranslation('resumes')
  const previewContent = content ?? SAMPLE_RESUME_CONTENT
  const [open, setOpen] = useState<ResumeTemplateId | null>(null)
  const previews = useMemo(
    () =>
      Object.fromEntries(RESUME_TEMPLATE_IDS.map((id) => [id, renderResumeHtml(previewContent, id, pageSize, style)])) as Record<
        ResumeTemplateId,
        string
      >,
    [previewContent, pageSize, style]
  )

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[12px] text-text-muted">{t('templates.body')}</p>
        {!content && <p className="mt-1 text-[11px] text-text-faint">{t('templates.sampleNote')}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RESUME_TEMPLATE_IDS.map((id) => {
          const isSelected = id === selected
          return (
            <div
              key={id}
              className={`flex flex-col border bg-canvas-raised ${isSelected ? 'border-accent' : 'border-border'}`}
            >
              <button
                type="button"
                onClick={() => setOpen(id)}
                aria-label={t('templates.openPreview', { name: t(`templates.${id}.name`) })}
                className="max-h-72 cursor-pointer overflow-hidden border-b border-border-soft bg-canvas-inset p-2 text-left hover:bg-canvas-soft"
              >
                <ResumePreview html={previews[id]} pageSize={pageSize} decorative />
              </button>
              <div className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-text">{t(`templates.${id}.name`)}</span>
                  {isSelected ? (
                    <Tag label={t('templates.selected')} tone="success" />
                  ) : (
                    <Button size="sm" onClick={() => onSelect(id)} disabled={busy}>
                      {t('templates.select')}
                    </Button>
                  )}
                </div>
                <p className="text-[12px] text-text-muted">{t(`templates.${id}.description`)}</p>
              </div>
            </div>
          )
        })}
      </div>
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? t(`templates.${open}.name`) : ''} width="max-w-4xl">
        {open && (
          <div className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-text-muted">{t(`templates.${open}.description`)}</p>
              {open === selected ? (
                <Tag label={t('templates.selected')} tone="success" />
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    onSelect(open)
                    setOpen(null)
                  }}
                  disabled={busy}
                >
                  {t('templates.select')}
                </Button>
              )}
            </div>
            <div className="bg-canvas-inset p-3">
              <ResumePreview html={previews[open]} pageSize={pageSize} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
