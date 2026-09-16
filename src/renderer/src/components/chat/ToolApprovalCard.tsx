import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatToolCall, ToolApprovalDecision } from '@shared/types/chat'
import Button from '../ui/Button'
import Tooltip from '../ui/Tooltip'
import ToolPayloadView from './ToolPayloadView'
import { summarizeToolCall } from './toolCallSummary'

/**
 * Shown under a `ToolCallCard` row while its call sits at
 * `pending_approval` - the only place in the chat panel a tool call
 * actually blocks the turn on the user. Arguments are expanded by default
 * here (unlike the closed row a running/finished call gets), since this is
 * the one moment they're worth reading before deciding, and shown through
 * `ToolPayloadView` so they read as labelled rows unless the user asks
 * for the JSON. A warning seam on
 * the left rather than a full border, so it reads as part of the row it
 * hangs off rather than a separate box.
 */
export default function ToolApprovalCard({
  call,
  onRespond
}: {
  call: ChatToolCall
  onRespond: (decision: ToolApprovalDecision) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('chat')
  const [submitting, setSubmitting] = useState<ToolApprovalDecision | null>(null)

  const respond = async (decision: ToolApprovalDecision): Promise<void> => {
    if (submitting) return
    setSubmitting(decision)
    try {
      await onRespond(decision)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-l-2 border-warning bg-canvas-soft py-1.5 pr-2 pl-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] font-medium text-text">{t('approval.title', { tool: call.name })}</span>
        <span className="text-[11px] text-text-muted">{summarizeToolCall(call)}</span>
      </div>
      <ToolPayloadView title={t('toolCall.arguments')} toolName={call.name} section="arguments" raw={call.arguments} maxHeightClass="max-h-40" />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" loading={submitting === 'allow_once'} disabled={submitting !== null} onClick={() => void respond('allow_once')}>
          {t('approval.allowOnce')}
        </Button>
        <Tooltip label={t('approval.allowAlwaysHint')}>
          <Button
            size="sm"
            variant="secondary"
            loading={submitting === 'allow_always'}
            disabled={submitting !== null}
            onClick={() => void respond('allow_always')}
          >
            {t('approval.allowAlways')}
          </Button>
        </Tooltip>
        <Button size="sm" variant="danger" loading={submitting === 'deny'} disabled={submitting !== null} onClick={() => void respond('deny')}>
          {t('approval.deny')}
        </Button>
      </div>
    </div>
  )
}
