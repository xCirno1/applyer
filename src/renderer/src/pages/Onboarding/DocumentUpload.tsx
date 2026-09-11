import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import FileDrop from '../../components/ui/FileDrop'
import MetaList from '../../components/ui/MetaList'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import Spinner from '../../components/ui/Spinner'
import OnboardingShell from '../../components/onboarding/OnboardingShell'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useProfileStore } from '../../state/profileStore'
import type { DocumentKind } from '@shared/types/profile'

const ACCEPT =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export default function DocumentUpload({
  onNext,
  onBack
}: {
  onNext: () => void
  onBack: () => void
}): ReactElement {
  const documents = useProfileStore((s) => s.documents)
  const profile = useProfileStore((s) => s.profile)
  const uploadDocument = useProfileStore((s) => s.uploadDocument)
  const deleteDocument = useProfileStore((s) => s.deleteDocument)
  const { t } = useTranslation('onboarding')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [uploadingKind, setUploadingKind] = useState<DocumentKind | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const hasResume = documents.some((d) => d.kind === 'resume')
  const profileEmpty = !profile.fullName.trim()

  const handleFile = async (kind: DocumentKind, file: File): Promise<void> => {
    setUploadingKind(kind)
    try {
      const data = await fileToArrayBuffer(file)
      const result = await uploadDocument({ kind, filename: file.name, mimeType: file.type, data })
      if (!result.ok) {
        toast.error(result.error ? errorMessage(result.error) : t('documents.uploadFailed'))
      } else {
        toast.success(t('documents.uploaded', { filename: file.name }))
      }
    } catch (err) {
      // A file the browser cannot read at all (permissions, a file that
      // vanished between the picker and the read) never reaches the IPC
      // call, so it needs its own report rather than an upload that
      // silently never happens.
      console.error(`Could not read the selected file: ${String(err)}`)
      toast.error(t('documents.readFailed', { filename: file.name }))
    } finally {
      setUploadingKind(null)
    }
  }

  const handleRemove = async (documentId: string): Promise<void> => {
    setRemovingId(documentId)
    try {
      await deleteDocument(documentId)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <OnboardingShell
      step="documents"
      title={t('documents.title')}
      subtitle={t('documents.intro')}
      back={
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
      actions={
        <>
          {!hasResume && <span className="text-[11px] text-text-faint">{t('documents.resumeGate')}</span>}
          <Button variant="primary" onClick={onNext} disabled={!hasResume}>
            {t('nav.next')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {profileEmpty && (
          <Callout title={t('documents.emptyProfileTipTitle')}>{t('documents.emptyProfileTipBody')}</Callout>
        )}

        {documents.length > 0 && (
          <ul className="flex flex-col gap-1">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex h-7 items-center justify-between gap-2 border border-border-soft bg-canvas-soft px-2 text-[12px]"
              >
                <MetaList
                  className="min-w-0 text-text"
                  items={[
                    { key: 'kind', value: t(`documents.kind.${doc.kind}`), className: 'text-text-faint' },
                    { key: 'filename', value: doc.originalFilename, grow: true, title: doc.originalFilename }
                  ]}
                />
                <button
                  onClick={() => handleRemove(doc.id)}
                  disabled={removingId === doc.id}
                  className="flex shrink-0 cursor-pointer items-center gap-1 text-text-faint hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('documents.removeLabel', { filename: doc.originalFilename })}
                >
                  {removingId === doc.id && <Spinner className="h-3 w-3" />}
                  {t('documents.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FileDrop
            label={uploadingKind === 'resume' ? t('documents.uploadingResume') : t('documents.resumeRequired')}
            accept={ACCEPT}
            onFile={(file) => handleFile('resume', file)}
          />
          <FileDrop
            label={
              uploadingKind === 'cover_letter'
                ? t('documents.uploadingCoverLetter')
                : t('documents.coverLetterOptional')
            }
            accept={ACCEPT}
            onFile={(file) => handleFile('cover_letter', file)}
          />
        </div>

        <p className="text-[11px] text-text-faint">{t('documents.formats')}</p>
      </div>
    </OnboardingShell>
  )
}
