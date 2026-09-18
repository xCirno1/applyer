import { memo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppError } from '@shared/types/errorCodes'
import type { ChatToolCall, ChatUsage, ToolApprovalDecision } from '@shared/types/chat'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import Spinner from '../ui/Spinner'
import Tooltip from '../ui/Tooltip'
import MarkdownView from './MarkdownView'
import ReasoningBlock from './ReasoningBlock'
import ToolCallCard from './ToolCallCard'
import { formatCost, shortModelName } from './chatPanelLogic'

/**
 * The shape both a persisted `ChatMessage` and the in-flight streaming
 * message can be rendered from - `ChatThread` builds this from whichever
 * one it has, so `AssistantMessage` itself never has to know the
 * difference beyond the `streaming` flag (used to keep `ReasoningBlock`
 * visibly "thinking", to show a spinner line before the first token
 * lands, and to skip a footer nothing has a usage/model for yet).
 */
export interface AssistantMessageData {
  id: string
  content: string
  reasoning: string | null
  toolCalls: ChatToolCall[] | null
  modelId: string | null
  usage: ChatUsage | null
  error: AppError | null
  streaming: boolean
}

function AssistantMessageImpl({
  message,
  onRespondApproval
}: {
  message: AssistantMessageData
  onRespondApproval: (toolCallId: string, decision: ToolApprovalDecision) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('chat')
  const errorMessage = useErrorMessage()
  const { number } = useFormatters()

  const waitingForFirstToken =
    message.streaming && !message.content && !message.reasoning && !(message.toolCalls && message.toolCalls.length > 0)

  return (
    <div className="flex flex-col gap-1.5 pl-2.5">
      <span className="sr-only">{t('message.assistant')}</span>
      {waitingForFirstToken && (
        <span className="flex items-center gap-1.5 text-[12px] text-text-faint">
          <Spinner className="h-3 w-3 text-accent" />
          {t('message.thinking')}
        </span>
      )}
      {message.reasoning && <ReasoningBlock text={message.reasoning} streaming={message.streaming} />}
      {message.content && <MarkdownView content={message.content} />}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1">
          {message.toolCalls.map((call) => (
            <ToolCallCard key={call.id} call={call} onRespondApproval={onRespondApproval} />
          ))}
        </div>
      )}
      {message.error && <p className="text-[12px] text-danger">{errorMessage(message.error)}</p>}
      {message.usage && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
          {message.modelId && (
            <Tooltip label={message.modelId}>
              <span>{shortModelName(message.modelId)}</span>
            </Tooltip>
          )}
          {message.modelId && <span aria-hidden="true">·</span>}
          <span>{t('message.tokens', { prompt: number(message.usage.promptTokens), completion: number(message.usage.completionTokens) })}</span>
          {message.usage.costUsd != null && (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatCost(message.usage.costUsd)}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Memoized by the `message` object's own reference: `chatStoreLogic.ts`'s
 * fold never mutates a `ChatMessage` already in the array in place - a
 * change replaces it with a new object - so an unrelated message in the
 * same list keeps the exact same reference across every re-render, and this
 * skips re-rendering (and re-parsing its markdown) unless *this* message
 * actually changed.
 */
export default memo(AssistantMessageImpl)
