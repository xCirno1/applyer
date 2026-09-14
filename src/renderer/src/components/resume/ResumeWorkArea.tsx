import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResumeContent, ResumePageSize, ResumeTemplateId, ResumeStyle } from '@shared/types/resume'
import { renderResumeHtml } from '@shared/resume/templates'
import { renderResumeDiffHtml } from '@shared/resume/diffRender'
import { diffResumeContent, isDiffEmpty } from '@shared/resume/resumeDiff'
import Button from '../ui/Button'
import Tag from '../ui/Tag'
import ResumeEditor from './ResumeEditor'
import ResumePreview from './ResumePreview'

/*
 * The centre column of both the Variants and the Master tab: a mode strip
 * (Preview / Edit / Diff) over the document. Preview and Edit show the
 * *draft*, so an edit is visible in the rendered page as soon as the field
 * blurs, before Save; Diff compares the draft with the master for the same
 * reason. The Save / Discard bar only appears once something changed, so
 * the strip stays a strip the rest of the time.
 */

export type ResumeWorkMode = 'preview' | 'edit' | 'diff'

interface ResumeWorkAreaProps {
  draft: ResumeContent
  /** Changes whenever the draft hook reseeds so the editor's uncontrolled inputs remount. */
  draftVersion: string
  dirty: boolean
  templateId: ResumeTemplateId
  pageSize: ResumePageSize
  style: ResumeStyle
  /** When given, a Diff mode is offered against this content. */
  diffAgainst?: ResumeContent | null
  mode: ResumeWorkMode
  onModeChange: (mode: ResumeWorkMode) => void
  onDraftChange: (next: ResumeContent) => void
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  validationError: string | null
}

export default function ResumeWorkArea(props: ResumeWorkAreaProps): ReactElement {
  const { t } = useTranslation('resumes')
  const { draft, dirty, templateId, pageSize, style, mode, diffAgainst } = props
  const html = useMemo(() => renderResumeHtml(draft, templateId, pageSize, style), [draft, templateId, pageSize, style])
  // The diff is the same page with changes marked on it (see
  // `@shared/resume/diffRender`); the strip above it carries the counts.
  const diff = useMemo(
    () => (mode === 'diff' && diffAgainst ? diffResumeContent(diffAgainst, draft) : null),
    [mode, diffAgainst, draft]
  )
  const diffHtml = useMemo(
    () => (mode === 'diff' && diffAgainst ? renderResumeDiffHtml(diffAgainst, draft, templateId, pageSize, style) : null),
    [mode, diffAgainst, draft, templateId, pageSize, style]
  )
  const modes: ResumeWorkMode[] = diffAgainst !== undefined ? ['preview', 'edit', 'diff'] : ['preview', 'edit']

  // `min-w-0` matters: the preview sizes its frame to the width it measured,
  // and without it that explicit width becomes this column's minimum, so the
  // column can never shrink again once the window does and the whole page
  // grows a horizontal scrollbar instead of the preview scaling down.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-soft bg-canvas px-2">
        {modes.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => props.onModeChange(candidate)}
            className={`h-full cursor-pointer px-2.5 text-[12px] font-medium ${
              mode === candidate ? 'border-b-2 border-accent text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {t(`view.${candidate}`)}
          </button>
        ))}
        {dirty && (
          <div className="ml-auto flex items-center gap-2">
            <Tag label={t('status.unsaved')} tone="warning" />
            <Button size="sm" variant="ghost" onClick={props.onDiscard} disabled={props.saving}>
              {t('actions.discard')}
            </Button>
            <Button size="sm" variant="primary" onClick={props.onSave} loading={props.saving}>
              {props.saving ? t('actions.saving') : t('actions.save')}
            </Button>
          </div>
        )}
      </div>
      {props.validationError && (
        <p className="border-b border-border-soft bg-canvas-soft px-3 py-1.5 text-[12px] text-danger">{props.validationError}</p>
      )}
      {mode === 'diff' && diff && (
        <div className="flex h-7 shrink-0 items-center gap-3 border-b border-border-soft bg-canvas-soft px-3 text-[12px]">
          {isDiffEmpty(diff) ? (
            <span className="text-text-muted">{t('diff.noChanges')}</span>
          ) : (
            <>
              <span className="text-text-muted">{t('diff.title')}</span>
              <span className="text-success">+{diff.summary.added}</span>
              <span className="text-danger">-{diff.summary.removed}</span>
              <span className="text-text">~{diff.summary.changed}</span>
              <span className="ml-auto text-text-faint">{t('diff.legend')}</span>
            </>
          )}
        </div>
      )}
      <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${mode === 'edit' ? 'bg-canvas' : 'bg-canvas-inset p-3'}`}>
        {mode === 'preview' && (
          <div className="mx-auto max-w-[8.5in]">
            <ResumePreview html={html} pageSize={pageSize} />
          </div>
        )}
        {mode === 'edit' && (
          <div className="p-3">
            <ResumeEditor key={props.draftVersion} content={draft} onChange={props.onDraftChange} disabled={props.saving} />
          </div>
        )}
        {mode === 'diff' && diffHtml !== null && (
          <div className="mx-auto max-w-[8.5in]">
            <ResumePreview html={diffHtml} pageSize={pageSize} />
          </div>
        )}
      </div>
    </div>
  )
}
