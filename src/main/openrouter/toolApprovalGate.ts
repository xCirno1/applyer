import type { PendingToolApproval, ToolApprovalDecision } from '@shared/types/chat'

/**
 * Pauses a chat tool call on the user's inline Allow/Deny (see
 * `ChatStreamEvent`'s `tool_approval_requested`), the chat equivalent of
 * `browser/agentPermissionGate.ts` for the CLI's form-filling permissions.
 * Deliberately a much smaller module than that one: there is no timeout
 * here (a chat tool call waiting on the user can sit for as long as the
 * chat panel is open, the runner is already built to tolerate a tool call
 * blocking for minutes, same as `inspect_application`/`fill_application`
 * do against the permission gate), and no "announce the next pending
 * request" bookkeeping, since the renderer already knows which message and
 * tool call it is looking at from the `tool_approval_requested` event
 * itself and can just ask `listPendingApprovals` if it needs to recover
 * after a reload.
 *
 * `cancelApprovalsForSession` exists for the one case the CLI's gate never
 * has to handle: the user can stop a chat turn outright (`stopChatTurn`)
 * while a call in it is still waiting on approval. That resolves every
 * pending approval for the session as `deny`, but flagged `cancelled` so
 * the runner can record the tool call as `cancelled` rather than
 * `denied`: the user stopped the whole turn, they didn't specifically
 * reject that one call.
 */

export type ToolApprovalResolution = { decision: ToolApprovalDecision; cancelled: boolean }

interface PendingEntry {
  request: PendingToolApproval
  resolve: (resolution: ToolApprovalResolution) => void
}

const pending = new Map<string, PendingEntry>()

/** Resolves once `resolveApproval` or `cancelApprovalsForSession` answers this exact call; never rejects and never times out on its own. */
export function requestApproval(request: PendingToolApproval): Promise<ToolApprovalResolution> {
  return new Promise((resolve) => {
    pending.set(request.toolCallId, { request, resolve })
  })
}

/** Answers a pending approval. Returns false if no call with that id is currently waiting (already answered, already cancelled, or never asked). */
export function resolveApproval(toolCallId: string, decision: ToolApprovalDecision): boolean {
  const entry = pending.get(toolCallId)
  if (!entry) return false
  pending.delete(toolCallId)
  entry.resolve({ decision, cancelled: false })
  return true
}

export function listPendingApprovals(): PendingToolApproval[] {
  return [...pending.values()].map((entry) => entry.request)
}

/** Resolves every still-pending approval for a session as a cancelled deny, called when the user stops the turn, and at startup by `recoverInterruptedTurns` for whatever a previous process left waiting. */
export function cancelApprovalsForSession(sessionId: string): void {
  for (const [toolCallId, entry] of pending) {
    if (entry.request.sessionId !== sessionId) continue
    pending.delete(toolCallId)
    entry.resolve({ decision: 'deny', cancelled: true })
  }
}

/** Test-only: drops every pending approval regardless of session, so one test's leftovers can't leak into the next. */
export function __resetToolApprovalGateForTests(): void {
  pending.clear()
}
