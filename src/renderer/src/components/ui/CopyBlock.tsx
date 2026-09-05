import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

interface CopyBlockProps {
  /** The exact text copied to the clipboard, and what the block renders. */
  text: string
  /** Optional caption above the block, e.g. which file the snippet goes in. */
  caption?: string
  /** `pre` keeps the text verbatim (config snippets); `wrap` reflows it (prose prompts). */
  variant?: 'pre' | 'wrap'
}

const COPIED_FEEDBACK_MS = 2000

/**
 * A read-only block of text with a Copy button in its corner. Generic on
 * purpose: it is the MCP config snippet in Settings/onboarding and the
 * suggested first prompt on the onboarding payoff screen, and neither knows
 * anything the other doesn't.
 *
 * The clipboard write can genuinely fail (a renderer without clipboard
 * permission, a headless run), so the failure gets its own button label
 * rather than leaving the button looking like it did nothing.
 */
export default function CopyBlock({ text, caption, variant = 'pre' }: CopyBlockProps): ReactElement {
  const { t } = useTranslation()
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The timeout outlives a fast unmount (closing Settings right after a
  // copy), which would otherwise set state on a dead component.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setResult('copied')
    } catch (err) {
      console.error(`Could not copy to the clipboard: ${String(err)}`)
      setResult('failed')
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setResult('idle'), COPIED_FEEDBACK_MS)
  }

  return (
    <div className="flex flex-col gap-1">
      {caption && <span className="text-[11px] text-text-faint">{caption}</span>}
      <div className="relative border border-border-soft bg-canvas-inset">
        <pre
          className={`overflow-x-auto py-2 pl-2 pr-16 text-[12px] text-text ${
            variant === 'wrap' ? 'whitespace-pre-wrap break-words' : ''
          }`}
        >
          <code>{text}</code>
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className={`absolute right-1.5 top-1.5 h-5 cursor-pointer border border-border bg-canvas-soft px-1.5 text-[11px] hover:text-text ${
            result === 'failed' ? 'text-danger' : 'text-text-muted'
          }`}
        >
          {result === 'copied'
            ? t('actions.copied')
            : result === 'failed'
              ? t('actions.copyFailed')
              : t('actions.copy')}
        </button>
      </div>
    </div>
  )
}
