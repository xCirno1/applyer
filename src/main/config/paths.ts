import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { activeStorageRoot } from './storageLocation'

// documentsDir/screenshotsDir/logsDir are relocatable (see storageLocation.ts) —
// everything below this comment stays pinned to the OS-default userData dir
// regardless of the active storage location.

export function documentsDir(): string {
  const dir = join(activeStorageRoot(), 'documents')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function screenshotsDir(): string {
  const dir = join(activeStorageRoot(), 'screenshots')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function logsDir(): string {
  const dir = join(activeStorageRoot(), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function tempDir(): string {
  const dir = join(app.getPath('temp'), 'applyer-tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Empties the temp directory, called once at startup.
 *
 * What lands there is decrypted: `fillTaskRunner` writes the candidate's
 * resume and cover letter out in the clear because Playwright uploads a file
 * by path, and deletes them again in a `finally`. A crash, a kill, or a power
 * cut skips that `finally`, and nothing else ever looked at the directory —
 * so a copy of the user's resume could sit in the system temp directory
 * indefinitely, having been encrypted at rest everywhere else.
 *
 * Best-effort by design: it runs before the window exists, and a file some
 * other process still holds open is not a reason to fail the launch.
 */
export function purgeTempDir(): void {
  rmSync(tempDir(), { recursive: true, force: true })
}

// Dedicated cwd for the embedded terminal — NOT the user's home directory —
// so the project-scoped CLAUDE.md/AGENTS.md written by writeAgentInstructions()
// only steers agent sessions started from Applyer's terminal, rather than
// leaking applyer-specific tool guidance into the user's other, unrelated
// Claude Code/Codex projects (which would happen with the user-level
// ~/.claude/CLAUDE.md or ~/.codex/AGENTS.md memory files).
export function agentWorkspaceDir(): string {
  const dir = join(app.getPath('userData'), 'workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Where a packaged build downloads its own managed Chromium, if no system Chrome/Edge is found — writable, unlike the (often read-only) app resources directory. */
export function playwrightBrowsersDir(): string {
  const dir = join(app.getPath('userData'), 'playwright-browsers')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function mcpSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\applyer-mcp'
  }
  return join(app.getPath('userData'), 'mcp.sock')
}
