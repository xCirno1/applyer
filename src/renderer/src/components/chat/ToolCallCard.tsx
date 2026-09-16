import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatToolCall, ToolApprovalDecision } from '@shared/types/chat'
import Spinner from '../ui/Spinner'
import ToolApprovalCard from './ToolApprovalCard'
import ToolPayloadView from './ToolPayloadView'
import { summarizeToolCall, summarizeToolResult } from './toolCallSummary'

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function StatusGlyph({ status }: { status: ChatToolCall['status'] }): ReactElement {
  if (status === 'running') return <Spinner className="h-3 w-3 text-accent" />
  if (status === 'pending_approval') return <PendingIcon />
  if (status === 'done') return <CheckIcon />
  if (status === 'error') return <ErrorIcon />
  return <MutedIcon />
}

/**
 * One row per tool call in an assistant message, the way a coding agent's
 * transcript lists them: a status glyph, the tool's name, the one-line
 * summary of what it was asked (`toolCallSummary.ts`), and how long it
 * took. The row is itself the disclosure: clicking it opens the
 * arguments and result underneath (`ToolPayloadView`, readable rows or
 * raw JSON, each section switchable), on a left seam rather than in a
 * bordered box, so a turn with a dozen calls stays a dozen short lines.
 * `pending_approval` renders `ToolApprovalCard` under the row whether or
 * not it is open - that card is the only place the turn blocks on the
 * user, so it is never something to hunt for.
 */
export default function ToolCallCard({
  call,
  onRespondApproval
}: {
  call: ChatToolCall
  onRespondApproval: (toolCallId: string, decision: ToolApprovalDecision) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)

  const resultSummary = summarizeToolResult(call)
  const muted = call.status === 'denied' || call.status === 'cancelled'
  const pending = call.status === 'pending_approval'

  const statusLabel =
    call.status === 'denied'
      ? t('toolCall.denied')
      : call.status === 'cancelled'
        ? t('toolCall.cancelled')
        : call.status === 'error'
          ? t('toolCall.error')
          : null

  return (
    <div className={`flex flex-col ${muted ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t('toolCall.collapse', { tool: call.name }) : t('toolCall.expand', { tool: call.name })}
        className="flex h-6 w-full cursor-pointer items-center gap-1.5 px-1 text-left hover:bg-canvas-soft"
      >
        <span className="flex w-3 shrink-0 items-center justify-center">
          <StatusGlyph status={call.status} />
        </span>
        <code className="shrink-0 text-[11px] text-text">{call.name}</code>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{summarizeToolCall(call)}</span>
        {statusLabel && <span className={`shrink-0 text-[11px] ${call.status === 'error' ? 'text-danger' : 'text-text-faint'}`}>{statusLabel}</span>}
        {call.durationMs !== null && <span className="shrink-0 text-[11px] text-text-faint">{formatDuration(call.durationMs)}</span>}
        <ChevronIcon open={open} />
      </button>

      {resultSummary && !open && !pending && (
        <span className={`truncate pl-5.5 text-[11px] ${call.isError ? 'text-danger' : 'text-text-faint'}`}>{resultSummary}</span>
      )}

      {pending && (
        <div className="mt-1 ml-5">
          <ToolApprovalCard call={call} onRespond={(decision) => onRespondApproval(call.id, decision)} />
        </div>
      )}

      {open && (
        <div className="mt-1 ml-2.5 flex flex-col gap-2 border-l border-border-soft pl-2.5">
          {resultSummary && <span className={`text-[11px] ${call.isError ? 'text-danger' : 'text-text-muted'}`}>{resultSummary}</span>}
          <ToolPayloadView title={t('toolCall.arguments')} toolName={call.name} section="arguments" raw={call.arguments} />
          {call.result !== null && (
            <ToolPayloadView title={t('toolCall.result')} toolName={call.name} section="result" raw={call.result} tone={call.isError ? 'error' : 'default'} />
          )}
        </div>
      )}
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-text-faint transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PendingIcon(): ReactElement {
  return (
    <svg className="h-3 w-3 text-warning" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3.5v3l2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon(): ReactElement {
  return (
    <svg className="h-3 w-3 text-success" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.3 5 8.8 9.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ErrorIcon(): ReactElement {
  return (
    <svg className="h-3 w-3 text-danger" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function MutedIcon(): ReactElement {
  return (
    <svg className="h-3 w-3 text-text-faint" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 4l4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
