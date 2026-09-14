import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import CopyBlock from '../ui/CopyBlock'
import Button from '../ui/Button'
import { useSendToTerminal } from '../../providers/TerminalInputContext'

/*
 * The app has no model of its own: every content change comes from the
 * agent in the embedded terminal (through the MCP tools) or from the editor.
 * So the "make the agent do it" affordance is a sentence, the same device
 * the onboarding payoff screen uses for the first prompt. Inside the shell
 * the sentence can be typed straight into the terminal below (the user still
 * presses Enter, so nothing runs behind their back); Copy stays for people
 * running the agent somewhere else. The sentences name the MCP-facing
 * concepts (master resume, variants by name) so the agent's instructions and
 * the user's request line up.
 *
 * `write` is an example rather than a request about a particular variant:
 * what a new variant should focus on is the user's to say, so the sentence
 * names a made-up variant and the hint says to change it. It sits behind
 * the tip under the variant list, not in a variant's details, because a
 * saved variant has nothing left to write.
 */

export type TailorPromptKind =
  | { kind: 'import'; hasUpload: boolean }
  /** No variant on this job yet: ask for one written for the posting. */
  | { kind: 'tailor'; title: string; company: string }
  /** A current variant is assigned: ask the agent to adjust it for the posting. */
  | { kind: 'use'; name: string; title: string; company: string }
  /** The assigned (or shown) variant is stale: ask for a refresh against the master. */
  | { kind: 'refresh'; name: string }
  /** From the Variants tab's tip: an example of asking for a new variant. */
  | { kind: 'write' }

interface TailorPromptBlockProps {
  prompt: TailorPromptKind
  /** Called after the sentence has been typed into the terminal (a modal will want to close). */
  onSent?: () => void
}

export default function TailorPromptBlock({ prompt, onSent }: TailorPromptBlockProps): ReactElement {
  const { t } = useTranslation('resumes')
  const sendToTerminal = useSendToTerminal()
  let text: string
  switch (prompt.kind) {
    case 'import':
      text = prompt.hasUpload ? t('prompts.import') : t('prompts.importNoUpload')
      break
    case 'tailor':
      text = t('prompts.tailor', { title: prompt.title, company: prompt.company })
      break
    case 'use':
      text = t('prompts.use', { name: prompt.name, title: prompt.title, company: prompt.company })
      break
    case 'refresh':
      text = t('prompts.refresh', { name: prompt.name })
      break
    case 'write':
      text = t('prompts.write')
      break
  }
  return (
    <div className="flex flex-col gap-1.5">
      <CopyBlock text={text} variant="wrap" caption={t('prompts.caption')} />
      {prompt.kind === 'write' && <p className="text-[11px] text-text-faint">{t('prompts.writeHint')}</p>}
      {sendToTerminal && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              sendToTerminal(text)
              onSent?.()
            }}
          >
            {t('prompts.send')}
          </Button>
        </div>
      )}
    </div>
  )
}
