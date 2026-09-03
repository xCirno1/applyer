import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import FileDrop from '../../components/ui/FileDrop'
import MetaList from '../../components/ui/MetaList'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useProfileStore } from '../../state/profileStore'
import type { DocumentKind } from '@shared/types/profile'

const ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export default function DocumentUpload({ onNext, onBack }: { onNext: () => void; onBack: () => void }): ReactElement {
  const documents = useProfileStore((s) => s.documents)
  const uploadDocument = useProfileStore((s) => s.uploadDocument)
  const deleteDocument = useProfileStore((s) => s.deleteDocument)
  const { t } = useTranslation('onboarding')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [uploadingKind, setUploadingKind] = useState<DocumentKind | null>(null)

  const hasResume = documents.some((d) => d.kind === 'resume')

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
    } finally {
      setUploadingKind(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">{t('documents.title')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{t('documents.intro')}</p>
      </div>

      {documents.length > 0 && (
        <ul className="flex flex-col gap-1">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex h-7 items-center justify-between border border-border-soft bg-canvas-soft px-2 text-[12px]"
            >
              <MetaList
                className="text-text"
                items={[
                  { key: 'kind', value: doc.kind, className: 'text-text-faint' },
                  { key: 'filename', value: doc.originalFilename, grow: true, title: doc.originalFilename }
                ]}
              />
              <button
                onClick={() => deleteDocument(doc.id)}
                className="cursor-pointer text-text-faint hover:text-danger"
                aria-label={t('documents.removeLabel', { filename: doc.originalFilename })}
              >
                {t('documents.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

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

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!hasResume}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  )
}
