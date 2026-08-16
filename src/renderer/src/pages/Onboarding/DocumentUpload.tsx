import { useState, type ReactElement } from 'react'
import FileDrop from '../../components/ui/FileDrop'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
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
  const toast = useToast()
  const [uploadingKind, setUploadingKind] = useState<DocumentKind | null>(null)

  const hasResume = documents.some((d) => d.kind === 'resume')

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">Your documents</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          A resume is required. The agent reads these to judge fit and can attach them when filling out forms.
        </p>
      </div>

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
                onClick={() => deleteDocument(doc.id)}
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
        label={uploadingKind === 'resume' ? 'Uploading resume…' : 'Resume (required)'}
        accept={ACCEPT}
        onFile={(file) => handleFile('resume', file)}
      />
      <FileDrop
        label={uploadingKind === 'cover_letter' ? 'Uploading cover letter…' : 'Cover letter (optional)'}
        accept={ACCEPT}
        onFile={(file) => handleFile('cover_letter', file)}
      />

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!hasResume}>
          Next
        </Button>
      </div>
    </div>
  )
}
