import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { appLogger } from '../logger'
import { agentWorkspaceDir } from '../config/paths'
import { getAutoStartCommand } from '../db/repositories/settingsRepository'

export interface PtySession {
  id: string
  process: pty.IPty
}

const sessions = new Map<string, PtySession>()

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

export function createSession(
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (code: number) => void
): string {
  const id = randomUUID()
  const shell = defaultShell()

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(1, Math.trunc(cols) || 80),
    rows: Math.max(1, Math.trunc(rows) || 24),
    cwd: agentWorkspaceDir(),
    env: process.env as Record<string, string>
  })

  ptyProcess.onData(onData)
  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(id)
    onExit(exitCode)
  })

  sessions.set(id, { id, process: ptyProcess })
  appLogger.info(`Terminal session ${id} started (shell: ${shell})`)

  const autoStartCommand = getAutoStartCommand()
  if (autoStartCommand) {
    // Fed to the shell's input queue right after spawn — the OS-level pty
    // buffers it, so it's picked up once the shell is ready to read a line
    // even though nothing has been typed by the user yet.
    ptyProcess.write(`${autoStartCommand}\r`)
  }

  return id
}

export function writeToSession(id: string, data: string): void {
  sessions.get(id)?.process.write(data)
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (!session) return
  const safeCols = Math.max(1, Math.trunc(cols) || 80)
  const safeRows = Math.max(1, Math.trunc(rows) || 24)
  try {
    session.process.resize(safeCols, safeRows)
  } catch (err) {
    appLogger.warn(`Failed to resize terminal ${id}: ${String(err)}`)
  }
}

export function disposeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.process.kill()
  sessions.delete(id)
}

export function disposeAllSessions(): void {
  for (const id of Array.from(sessions.keys())) {
    disposeSession(id)
  }
}
