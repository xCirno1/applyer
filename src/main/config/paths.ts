import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

export function documentsDir(): string {
  const dir = join(app.getPath('userData'), 'documents')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function screenshotsDir(): string {
  const dir = join(app.getPath('userData'), 'screenshots')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function logsDir(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function tempDir(): string {
  const dir = join(app.getPath('temp'), 'jobhunt-tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function mcpSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\jobhunt-mcp'
  }
  return join(app.getPath('userData'), 'mcp.sock')
}
