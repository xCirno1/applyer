import { useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

interface FileDropProps {
  label: string
  accept: string
  onFile: (file: File) => void
}

export default function FileDrop({ label, accept, onFile }: FileDropProps): ReactElement {
  const { t } = useTranslation()
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={`flex h-20 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-3 text-center transition-colors ${
        dragActive ? 'border-accent bg-canvas-soft' : 'border-border-soft hover:border-border'
      }`}
    >
      <span className="text-[12px] text-text-muted">{label}</span>
      <span className="text-[11px] text-text-faint">{t('fileDrop.hint')}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
