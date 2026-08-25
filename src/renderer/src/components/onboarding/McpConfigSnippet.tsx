import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export default function McpConfigSnippet({ snippet }: { snippet: string }): ReactElement {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative border border-border-soft bg-canvas-inset">
      <pre className="overflow-x-auto p-2 text-[12px] text-text">
        <code>{snippet}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 h-5 cursor-pointer border border-border bg-canvas-soft px-1.5 text-[11px] text-text-muted hover:text-text"
      >
        {copied ? t('actions.copied') : t('actions.copy')}
      </button>
    </div>
  )
}
