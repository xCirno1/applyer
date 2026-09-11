import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import FileDrop from '../../components/ui/FileDrop'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useProfileStore } from '../../state/profileStore'
import type { DocumentKind, DocumentSummary } from '@shared/types/profile'

const ACCEPT =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

const KINDS: DocumentKind[] = ['resume', 'cover_letter', 'other']

function kindLabels(
  kind: DocumentKind,
  t: TFunction<'settings'>
): { header: string; add: string; uploading: string } {
  switch (kind) {
    case 'resume':
      return { header: t('documents.kindResume'), add: t('documents.addResume'), uploading: t('documents.uploadingResume') }
    case 'cover_letter':
      return {
        header: t('documents.kindCoverLetter'),
        add: t('documents.addCoverLetter'),
        uploading: t('documents.uploadingCoverLetter')
      }
    case 'other':
      return { header: t('documents.kindOther'), add: t('documents.addOther'), uploading: t('documents.uploadingOther') }
  }
}

function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export default function DocumentsSection(): ReactElement {
  const documents = useProfileStore((s) => s.documents)
  const loaded = useProfileStore((s) => s.loaded)
  const fetchProfile = useProfileStore((s) => s.fetch)
  const uploadDocument = useProfileStore((s) => s.uploadDocument)
  const deleteDocument = useProfileStore((s) => s.deleteDocument)
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [uploadingKind, setUploadingKind] = useState<DocumentKind | null>(null)

  useEffect(() => {
    if (!loaded) fetchProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleDelete = async (id: string, filename: string): Promise<void> => {
    await deleteDocument(id)
    toast.info(t('documents.removed', { filename }))
  }

  const documentsByKind = (kind: DocumentKind): DocumentSummary[] => documents.filter((doc) => doc.kind === kind)

  return (
    <div className="grid grid-cols-3 gap-3">
      {KINDS.map((kind) => {
        const labels = kindLabels(kind, t)
        const kindDocuments = documentsByKind(kind)
        return (
          <div key={kind} className="flex flex-col gap-2 border border-border-soft bg-canvas-soft p-2">
            <span className="text-[12px] font-medium text-text">{labels.header}</span>
            {kindDocuments.length > 0 && (
              <ul className="flex flex-col gap-1">
                {kindDocuments.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex h-7 items-center justify-between gap-2 border border-border-soft bg-canvas px-2 text-[12px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-text" title={doc.originalFilename}>
                      {doc.originalFilename}
                    </span>
                    <button
                      onClick={() => handleDelete(doc.id, doc.originalFilename)}
                      className="shrink-0 cursor-pointer text-text-faint hover:text-danger"
                      aria-label={t('documents.removeLabel', { filename: doc.originalFilename })}
                    >
                      {t('documents.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <FileDrop
              label={uploadingKind === kind ? labels.uploading : labels.add}
              accept={ACCEPT}
              onFile={(file) => handleFile(kind, file)}
            />
          </div>
        )
      })}
    </div>
  )
}
