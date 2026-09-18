import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CHAT_INPUT_MAX_CHARS, type ChatSession } from '@shared/types/chat'
import Spinner from '../ui/Spinner'
import Tooltip from '../ui/Tooltip'
import { registerChatComposer } from './chatBridge'
import ChatModelMenu from './ChatModelMenu'

/** The textarea grows with its content up to this, then scrolls; about seven lines. */
const MAX_INPUT_HEIGHT_PX = 168
/** The counter switches to a warning tone once this close to the cap, rather than only turning red right at it. */
const WARN_RATIO = 0.9

/**
 * The chat panel's input: one bordered box holding the textarea and, on
 * its bottom row, the model control (`ChatModelMenu`) and the send/stop
 * button, the shape a sidebar chat client gives its prompt. Registers
 * itself with `chatBridge.ts` on mount so "send this to the agent"
 * buttons elsewhere in the app (`TailorPromptBlock`, the job detail
 * modal, `ChatWelcome`'s starters) can reach it the same way they reach
 * the terminal; see that module's doc comment. The draft is component
 * state, which is why the panel stays mounted across mode switches
 * (`App.tsx`): unmounting would drop a half-written prompt.
 */
export default function ChatComposer({
  session,
  busy,
  onSend,
  onStop,
  onBridgeInsert
}: {
  /** The session the message goes to; null while none is selected (the box is then disabled). */
  session: ChatSession | null
  busy: boolean
  /** Resolves with whether main accepted the message; the draft is only cleared on `true`, so a refused send (connection cleared, session gone) leaves it there to retry or copy. */
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  /** Text arrived through `chatBridge` (a "send to agent" button); the panel uses it to make sure the thread, not the session list, is showing. */
  onBridgeInsert: () => void
}): ReactElement {
  const { t } = useTranslation('chat')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const focusAfterInsertRef = useRef(false)

  const onBridgeInsertRef = useRef(onBridgeInsert)
  useEffect(() => {
    onBridgeInsertRef.current = onBridgeInsert
  }, [onBridgeInsert])

  useEffect(() => {
    registerChatComposer({
      insertText: (inserted) => {
        setText((current) => (current ? `${current}\n${inserted}` : inserted))
        focusAfterInsertRef.current = true
        onBridgeInsertRef.current()
      }
    })
    return () => registerChatComposer(null)
  }, [])

  // Runs after every text change, but only actually moves focus when the
  // change came from `chatBridge` (the "send to agent" buttons elsewhere in
  // the app), not from the user's own typing - tied to the commit that
  // followed the insert rather than guessed with a timer, since the
  // textarea's value has to already reflect the inserted text before the
  // caret can be placed at its end.
  useEffect(() => {
    if (!focusAfterInsertRef.current) return
    focusAfterInsertRef.current = false
    const el = textAreaRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [text])

  // Grow to fit, measured off the real scroll height rather than counted
  // newlines, so a long wrapped paragraph gets room too. Layout effect so
  // the box never paints at the old height for a frame.
  useLayoutEffect(() => {
    const el = textAreaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_INPUT_HEIGHT_PX, el.scrollHeight)}px`
  }, [text])

  const disabled = session === null
  const trimmed = text.trim()
  const overLimit = trimmed.length > CHAT_INPUT_MAX_CHARS
  const canSend = !disabled && !busy && !sending && trimmed.length > 0 && !overLimit

  const send = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    let accepted = false
    try {
      accepted = await onSend(trimmed)
    } finally {
      setSending(false)
    }
    if (accepted) setText('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && busy) {
      event.preventDefault()
      onStop()
      return
    }
    // Shift+Enter is the terminal's own "insert a newline, don't submit"
    // convention (see `terminal/terminalKeys.ts`) - mirrored here so the
    // two agent surfaces behave the same way. Plain Enter, and Ctrl/Cmd+Enter,
    // both send.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const nearLimit = trimmed.length > CHAT_INPUT_MAX_CHARS * WARN_RATIO
  const counterTone = overLimit ? 'text-danger' : 'text-warning'

  return (
    <div className="flex shrink-0 flex-col gap-1 px-2 pt-1 pb-2">
      <div
        className={`flex flex-col border bg-canvas ${disabled ? 'border-border-soft' : 'border-border focus-within:border-accent'}`}
      >
        <textarea
          ref={textAreaRef}
          aria-label={t('composer.label')}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={t('composer.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[13px] leading-5 text-text outline-none placeholder:text-text-faint disabled:cursor-not-allowed"
        />
        <div className="flex h-7 items-center gap-1 px-1.5">
          <ChatModelMenu session={session} disabled={busy} />
          <span className="ml-auto" />
          {(nearLimit || overLimit) && (
            <span className={`text-[11px] ${counterTone}`}>{t('composer.charCount', { count: trimmed.length, max: CHAT_INPUT_MAX_CHARS })}</span>
          )}
          {busy ? (
            <Tooltip label={t('composer.stopHint')}>
              <button
                type="button"
                onClick={onStop}
                aria-label={t('composer.stop')}
                className="flex h-6 w-6 cursor-pointer items-center justify-center bg-danger text-danger-fg hover:opacity-90"
              >
                <StopIcon />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={t('composer.sendHint')}>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                aria-label={t('composer.send')}
                className="flex h-6 w-6 cursor-pointer items-center justify-center bg-accent text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? <Spinner className="h-3 w-3" /> : <SendIcon />}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <span className="px-0.5 text-[11px] text-text-faint">{t('composer.hint')}</span>
    </div>
  )
}

function SendIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 10V2M6 2L2.5 5.5M6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StopIcon(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" />
    </svg>
  )
}
