import { useEffect, useState, type ReactElement } from 'react'
import FileDrop from '../../components/ui/FileDrop'
import { useToast } from '../../components/ui/useToast'
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

export default function DocumentsSection(): ReactElement {
  const documents = useProfileStore((s) => s.documents)
  const loaded = useProfileStore((s) => s.loaded)
  const fetchProfile = useProfileStore((s) => s.fetch)
  const uploadDocument = useProfileStore((s) => s.uploadDocument)
  const deleteDocument = useProfileStore((s) => s.deleteDocument)
  const toast = useToast()
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
        toast.error(result.error ?? 'Upload failed.')
      } else {
        toast.success(`${file.name} uploaded.`)
      }
    } finally {
      setUploadingKind(null)
    }
  }

  const handleDelete = async (id: string, filename: string): Promise<void> => {
    await deleteDocument(id)
    toast.info(`${filename} removed.`)
  }

  return (
    <div className="flex flex-col gap-4">
      {documents.length > 0 && (
        <ul className="flex flex-col gap-1">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex h-7 items-center justify-between border border-border-soft bg-canvas-soft px-2 text-[12px]"
            >
              <span className="text-text">
                <span className="text-text-faint">{doc.kind}</span> · {doc.originalFilename}
              </span>
              <button
                onClick={() => handleDelete(doc.id, doc.originalFilename)}
                className="cursor-pointer text-text-faint hover:text-danger"
                aria-label={`Remove ${doc.originalFilename}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <FileDrop
        label={uploadingKind === 'resume' ? 'Uploading resume…' : 'Add / replace resume'}
        accept={ACCEPT}
        onFile={(file) => handleFile('resume', file)}
      />
      <FileDrop
        label={uploadingKind === 'cover_letter' ? 'Uploading cover letter…' : 'Add / replace cover letter'}
        accept={ACCEPT}
        onFile={(file) => handleFile('cover_letter', file)}
      />
      <FileDrop
        label={uploadingKind === 'other' ? 'Uploading…' : 'Add another document'}
        accept={ACCEPT}
        onFile={(file) => handleFile('other', file)}
      />
    </div>
  )
}
