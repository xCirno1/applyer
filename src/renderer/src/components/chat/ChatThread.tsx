import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useErrorMessage } from '../../i18n/formatError'
import type { ChatMessage, ToolApprovalDecision } from '@shared/types/chat'
import type { SessionMessagesState, SessionRuntimeState } from '../../state/chatStoreLogic'
import Skeleton from '../ui/Skeleton'
import Button from '../ui/Button'
import UserMessage from './UserMessage'
import AssistantMessage, { type AssistantMessageData } from './AssistantMessage'
import ChatWelcome from './ChatWelcome'

/** How close to the bottom counts as "still there" - a user nudging the wheel shouldn't unstick auto-scroll. */
const STICKY_BOTTOM_THRESHOLD_PX = 48

/**
 * The scrolling message list for one session. Auto-scrolls to the bottom
 * as the streaming message grows, but only while the user hasn't
 * scrolled away from it - reading an earlier message shouldn't get yanked
 * out from under you every time a delta arrives - and shows a "Jump to
 * latest" affordance instead while they have. `role="log"` +
 * `aria-live="polite"` so a screen reader narrates new content without
 * re-announcing the whole thread on every delta.
 */
export default function ChatThread({
  sessionId,
  messagesState,
  runtime,
  onLoadEarlier,
  onRespondApproval,
  onPickStarter
}: {
  sessionId: string
  messagesState: SessionMessagesState | null
  runtime: SessionRuntimeState | null
  onLoadEarlier: () => void
  onRespondApproval: (toolCallId: string, decision: ToolApprovalDecision) => Promise<void>
  /** A `ChatWelcome` starter was clicked: put it in the composer. */
  onPickStarter: (text: string) => void
}): ReactElement {
  const { t } = useTranslation('chat')
  const errorMessage = useErrorMessage()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stuckToBottom, setStuckToBottom] = useState(true)

  const respondApprovalRef = useRef(onRespondApproval)
  useEffect(() => {
    respondApprovalRef.current = onRespondApproval
  }, [onRespondApproval])
  const respond = useCallback(
    (toolCallId: string, decision: ToolApprovalDecision) => respondApprovalRef.current(toolCallId, decision),
    []
  )

  const messages = messagesState?.messages ?? []
  const streaming = runtime?.streaming ?? null
  // A failure with no message of its own, or whose message is not in the
  // loaded page with the error on it, gets a line at the end of the log.
  const failure = runtime?.lastError ?? null
  const failureShown =
    failure !== null && !(failure.messageId !== null && messages.some((message) => message.id === failure.messageId && message.error !== null))

  // Switching sessions starts stuck-to-bottom again - a freshly opened
  // thread should open on its latest message, not wherever the previous
  // session happened to leave the scroll position. Adjusted during render
  // (React's own pattern for resetting state when a prop changes) rather
  // than in an effect, so it takes effect the same commit the session
  // switches rather than one render later.
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId)
  if (sessionId !== renderedSessionId) {
    setRenderedSessionId(sessionId)
    setStuckToBottom(true)
  }

  useEffect(() => {
    if (!stuckToBottom) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessionId, messages.length, streaming?.content, streaming?.reasoning, streaming?.toolCalls.length, stuckToBottom])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setStuckToBottom(distanceFromBottom < STICKY_BOTTOM_THRESHOLD_PX)
  }

  const jumpToLatest = (): void => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setStuckToBottom(true)
  }

  if (!messagesState || (!messagesState.loadedOnce && messagesState.loading)) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    )
  }

  // An empty session gets the welcome block in place of the log, not a
  // "no messages" line inside it: there is nothing to scroll yet.
  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ChatWelcome onPick={onPickStarter} />
        {failureShown && <p className="px-3 pb-3 text-[12px] text-danger">{errorMessage(failure.error)}</p>}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3"
      >
        {messagesState.hasMore && (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" loading={messagesState.loading} onClick={onLoadEarlier}>
              {t('thread.loadEarlier')}
            </Button>
          </div>
        )}
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} onRespondApproval={respond} />
        ))}
        {streaming && (
          <AssistantMessage
            message={{
              id: streaming.messageId,
              content: streaming.content,
              reasoning: streaming.reasoning,
              toolCalls: streaming.toolCalls.length > 0 ? streaming.toolCalls : null,
              modelId: null,
              usage: null,
              error: null,
              streaming: true
            }}
            onRespondApproval={respond}
          />
        )}
        {failureShown && <p className="text-[12px] text-danger">{errorMessage(failure.error)}</p>}
      </div>
      {!stuckToBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 cursor-pointer border border-border bg-canvas-raised px-2 py-1 text-[11px] text-text shadow-pop hover:bg-canvas-soft"
        >
          {t('thread.jumpToLatest')}
        </button>
      )}
    </div>
  )
}

function MessageRow({
  message,
  onRespondApproval
}: {
  message: ChatMessage
  onRespondApproval: (toolCallId: string, decision: ToolApprovalDecision) => Promise<void>
}): ReactElement | null {
  // A `tool` role message is a persisted artifact of the same call the
  // owning assistant message already carries in full (see the doc comment
  // in `state/chatStoreLogic.ts`) - never its own row.
  if (message.role === 'tool') return null
  if (message.role === 'user') return <UserMessage content={message.content} />

  const data: AssistantMessageData = {
    id: message.id,
    content: message.content,
    reasoning: message.reasoning,
    toolCalls: message.toolCalls,
    modelId: message.modelId,
    usage: message.usage,
    error: message.error,
    streaming: false
  }
  return <AssistantMessage message={data} onRespondApproval={onRespondApproval} />
}
