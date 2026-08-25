import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
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
