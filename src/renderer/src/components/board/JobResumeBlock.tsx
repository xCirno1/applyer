import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobRecord } from '@shared/types/job'
import { diffResumeContent } from '@shared/resume/resumeDiff'
import { useResumesStore } from '../../state/resumesStore'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import Button from '../ui/Button'
import Select from '../ui/Select'
import ResumeStatusTag from '../resume/ResumeStatusTag'
import TailorPromptBlock from '../resume/TailorPromptBlock'

/*
 * The "Resume" block inside `JobDetailModal`: a picker for which resume
 * this job's application gets (the master by default, or any named
 * variant), one sentence saying what that means, and the two ways to have
 * the agent do the work instead. The full preview, diff and editor live on
 * the Resume Variants screen; this block only has to answer the question
 * someone opening a job actually has, and link out.
 *
 * "Master (default)" in the picker stands for "no variant assigned", which
 * resolves to the master or the original upload per the fallback setting;
 * the sentence under the picker spells out which. Only jobs that can still
 * be filled get the prompt to tailor: a submitted application has already
 * sent whatever it sent.
 */

const DEFAULT_OPTION = ''

interface JobResumeBlockProps {
  job: JobRecord
  onOpenResume: (jobId: string) => void
  /** The modal closes once the prompt is in the terminal, so the terminal is what the user sees next. */
  onPromptSent: () => void
}

export default function JobResumeBlock({ job, onOpenResume, onPromptSent }: JobResumeBlockProps): ReactElement {
  const { t } = useTranslation(['board', 'resumes'])
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const master = useResumesStore((s) => s.master)
  const settings = useResumesStore((s) => s.settings)
  const loadedOnce = useResumesStore((s) => s.loadedOnce)
  const fetch = useResumesStore((s) => s.fetch)
  const variants = useResumesStore((s) => s.variants)
  const assignedId = useResumesStore((s) => s.variantIdByJob.get(job.id) ?? null)
  const summary = useMemo(() => variants.find((variant) => variant.id === assignedId) ?? null, [variants, assignedId])
  const variant = useResumesStore((s) => (assignedId ? s.variantsById[assignedId] : undefined))
  const loadVariant = useResumesStore((s) => s.loadVariant)
  const assignVariant = useResumesStore((s) => s.assignVariant)
  const [showPrompt, setShowPrompt] = useState(false)
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    if (!loadedOnce) void fetch()
  }, [loadedOnce, fetch])

  useEffect(() => {
    if (assignedId && variant === undefined) void loadVariant(assignedId)
  }, [assignedId, variant, loadVariant])

  const changes = useMemo(() => {
    if (!master || !variant) return null
    const diff = diffResumeContent(master.content, variant.content).summary
    return t('resumes:diff.short', { added: diff.added, removed: diff.removed, changed: diff.changed })
  }, [master, variant, t])

  const canTailor = job.status === 'queued' || job.status === 'failed'

  let sentence: string
  if (summary) {
    sentence = t('board:detail.resumeAssigned', {
      name: summary.name,
      template: t(`resumes:templates.${summary.templateId}.name`),
      changes: changes ?? '…'
    })
  } else if (!master) {
    sentence = t('board:detail.resumeNoMaster')
  } else if (settings.fallbackAttachment === 'master') {
    sentence = t('board:detail.resumeMaster')
  } else {
    sentence = t('board:detail.resumeOriginal')
  }

  const handleAssign = async (value: string): Promise<void> => {
    const variantId = value === DEFAULT_OPTION ? null : value
    if (variantId === assignedId) return
    setAssigning(true)
    const result = await assignVariant(job.id, variantId)
    setAssigning(false)
    if (!result.ok) {
      toast.error(errorMessage(result.error))
      return
    }
    const chosen = variantId ? variants.find((item) => item.id === variantId) : null
    toast.success(chosen ? t('resumes:toast.variantAssigned', { name: chosen.name }) : t('resumes:toast.variantUnassigned'))
  }

  const options = [
    { value: DEFAULT_OPTION, label: t('board:detail.resumeDefault') },
    ...variants.map((item) => ({ value: item.id, label: item.name }))
  ]

  const prompt = summary
    ? summary.stale
      ? ({ kind: 'refresh', name: summary.name } as const)
      : ({ kind: 'use', name: summary.name, title: job.title, company: job.company } as const)
    : ({ kind: 'tailor', title: job.title, company: job.company } as const)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="text-[12px] font-medium text-text-muted">{t('board:detail.resume')}</p>
        {summary && <ResumeStatusTag stale={summary.stale} compact />}
      </div>
      {master && (
        <Select
          id={`job-resume-${job.id}`}
          label={t('board:detail.resumeSelect')}
          options={options}
          value={assignedId ?? DEFAULT_OPTION}
          onChange={(value) => void handleAssign(value)}
          disabled={assigning || !loadedOnce}
        />
      )}
      <p className="text-[12px] text-text-muted">{sentence}</p>
      {summary?.stale && <p className="text-[12px] text-warning">{t('board:detail.resumeStale')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onOpenResume(job.id)}>
          {t('board:detail.openResume')}
        </Button>
        {canTailor && master && (
          <Button size="sm" variant="ghost" onClick={() => setShowPrompt((value) => !value)} aria-expanded={showPrompt}>
            {t('board:detail.tailorWithAgent')}
          </Button>
        )}
      </div>
      {showPrompt && canTailor && master && <TailorPromptBlock prompt={prompt} onSent={onPromptSent} />}
    </div>
  )
}
