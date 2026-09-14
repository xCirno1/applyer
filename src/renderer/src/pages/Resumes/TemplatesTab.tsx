import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResumeTemplateId } from '@shared/types/resume'
import { useResumesStore } from '../../state/resumesStore'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import Skeleton from '../../components/ui/Skeleton'
import TemplatePicker from '../../components/resume/TemplatePicker'

/**
 * Templates tab: the picker over the master's content. Selecting sets the
 * master's default template. With no master yet there is nothing to write
 * to, so the thumbnails show sample content and a selection only moves the
 * highlight; the master starts on Classic and can be switched here after.
 */
export default function TemplatesTab(): ReactElement {
  const { t } = useTranslation('resumes')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const master = useResumesStore((s) => s.master)
  const loadedOnce = useResumesStore((s) => s.loadedOnce)
  const saveMaster = useResumesStore((s) => s.saveMaster)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<ResumeTemplateId>('classic')

  if (!loadedOnce) {
    return (
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const handleSelect = async (templateId: ResumeTemplateId): Promise<void> => {
    if (!master) {
      setPending(templateId)
      return
    }
    setBusy(true)
    const result = await saveMaster({ content: master.content, templateId })
    setBusy(false)
    if (result.ok) toast.success(t('toast.masterSaved'))
    else toast.error(errorMessage(result.error))
  }

  return (
    <div className="p-3">
      <TemplatePicker
        content={master?.content ?? null}
        pageSize={master?.pageSize ?? 'letter'}
        style={master?.style}
        selected={master?.templateId ?? pending}
        onSelect={(templateId) => void handleSelect(templateId)}
        busy={busy}
      />
    </div>
  )
}
