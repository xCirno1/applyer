import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Collapsible from '../ui/Collapsible'

/**
 * The model's reasoning trace, collapsed by default (it's supporting
 * detail, not the answer) using `ui/Collapsible` - which fits here since a
 * reasoning trace is exactly the "many lines of secondary detail behind one
 * header" shape that component exists for. Rendered as plain text rather
 * than through `MarkdownView`: reasoning traces are the model thinking out
 * loud, not a formatted reply, and re-parsing markdown on every delta while
 * it's the one part of the message still streaming is wasted work for text
 * nobody is meant to read as prose.
 */
export default function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }): ReactElement | null {
  const { t } = useTranslation('chat')
  if (!text) return null

  return (
    <Collapsible label={t('reasoning.label')} summary={streaming ? t('reasoning.thinking') : undefined}>
      <p className="whitespace-pre-wrap text-[12px] text-text-faint">{text}</p>
    </Collapsible>
  )
}
