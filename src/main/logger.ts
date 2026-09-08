import log from 'electron-log/main'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { inspect } from 'util'
import { activeStorageRoot } from './config/storageLocation'
import { readSecureField, writeSecureField } from './db/encryption'
import type { StorageMode } from '@shared/types/profile'

let logStorageMode: StorageMode = 'encrypted'

function secureLogFormat({
  data,
  level,
  message
}: {
  data: unknown[]
  level: string
  message: { date?: Date; scope?: string }
}): string[] {
  const rendered = `[${(message.date ?? new Date()).toISOString()}] [${level}]${message.scope ? ` (${message.scope})` : ''} ${data
    .map((value) => (typeof value === 'string' ? value : inspect(value, { depth: 5 })))
    .join(' ')}`.replace(/\r?\n/g, '\\n')
  try {
    return [writeSecureField(rendered, logStorageMode) ?? '']
  } catch {
    // A missing keychain must never make logger arguments fall through to a
    // plaintext file. Keep a non-sensitive marker and omit the entry.
    return ['[encrypted log entry omitted: secure storage unavailable]']
  }
}

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? false : 'debug'
// resolvePathFn is re-invoked on every write (not cached), so this follows
// activeStorageRoot() automatically once a storage-location migration commits.
log.transports.file.resolvePathFn = () => join(activeStorageRoot(), 'logs', 'app.log')
log.transports.file.format = secureLogFormat
log.transports.file.writeOptions = { ...log.transports.file.writeOptions, mode: 0o600 }

export const appLogger = log.scope('app')

export const mcpLogger = log.create({ logId: 'mcp' })
mcpLogger.transports.file.resolvePathFn = () => join(activeStorageRoot(), 'logs', 'mcp.log')
mcpLogger.transports.file.level = 'info'
mcpLogger.transports.console.level = app.isPackaged ? false : 'debug'
mcpLogger.transports.file.format = secureLogFormat
mcpLogger.transports.file.writeOptions = { ...mcpLogger.transports.file.writeOptions, mode: 0o600 }

/** Rewrites legacy/mixed log lines and changes how all future entries are stored. */
export function setLogStorageMode(mode: StorageMode): void {
  const dir = join(activeStorageRoot(), 'logs')
  const filenames = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : []
  for (const filename of filenames) {
    const path = join(dir, filename)
    const lines = readFileSync(path, 'utf-8').split('\n')
    const rewritten = lines.map((line) => {
      if (!line) return line
      const plain = readSecureField(line) ?? ''
      return writeSecureField(plain, mode) ?? ''
    })
    writeFileSync(path, rewritten.join('\n'), { mode: 0o600 })
  }
  logStorageMode = mode
}
