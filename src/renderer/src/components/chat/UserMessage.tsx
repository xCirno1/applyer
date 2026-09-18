import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import MarkdownView from './MarkdownView'

/**
 * A user turn: a left accent seam on a slightly raised strip, rather than
 * a chat "bubble" or a right-aligned column, so the thread stays one dense
 * column and the user's own words are still told apart from the agent's
 * at a glance. The label is visually hidden: the seam already says whose
 * turn it is, but a screen reader needs the word.
 */
export default function UserMessage({ content }: { content: string }): ReactElement {
  const { t } = useTranslation('chat')
  return (
    <div className="border-l-2 border-accent bg-canvas-soft py-1.5 pr-2 pl-2.5">
      <span className="sr-only">{t('message.you')}</span>
      <MarkdownView content={content} />
    </div>
  )
}
