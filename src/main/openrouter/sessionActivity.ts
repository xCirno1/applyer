/**
 * Which chat sessions currently have a turn running. A plain in-memory Set
 * rather than a database column: "busy" is main-process state that must
 * reset to false on every restart (a turn that was streaming when the app
 * quit is not still running), and the database would need to be told to
 * clear it on every boot for no benefit over just not persisting it at all.
 *
 * `listChatSessions()` always reports `busy: false` from the repository:
 * the IPC layer overlays this Set's answer on top of that before handing
 * sessions to the renderer. The agent runner (added separately) marks a
 * session busy right before it starts streaming a turn and idle again once
 * that turn ends, in a `try`/`finally` so a thrown error still clears it.
 * `deleteSession` in `ipc/chat.ts` reads `isSessionBusy` to refuse deleting
 * a session out from under a running turn.
 */

const busySessions = new Set<string>()

export function markSessionBusy(id: string): void {
  busySessions.add(id)
}

export function markSessionIdle(id: string): void {
  busySessions.delete(id)
}

export function isSessionBusy(id: string): boolean {
  return busySessions.has(id)
}

/** For diagnostics and the session list overlay; not ordered, no session is more "first" than another. */
export function busySessionIds(): string[] {
  return [...busySessions]
}
