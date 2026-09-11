import { beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetElectronMock } from '../../test/mocks/electron'
import { resolveActiveStorageRoot, activeStorageRoot } from './config/storageLocation'
import { readSecureField } from './db/encryption'
import { appLogger, mcpLogger, setLogStorageMode } from './logger'

beforeEach(() => {
  __resetElectronMock()
  resolveActiveStorageRoot()
  setLogStorageMode('encrypted')
})

describe('logging under Node tests', () => {
  it('uses the real encrypted file transports without loading the Electron package', () => {
    appLogger.info('private application message')
    mcpLogger.info('private MCP message')

    for (const [filename, message] of [
      ['app.log', 'private application message'],
      ['mcp.log', 'private MCP message']
    ] as const) {
      const line = readFileSync(join(activeStorageRoot(), 'logs', filename), 'utf-8').trim()
      expect(line).toMatch(/^enc:v1:/)
      expect(line).not.toContain(message)
      expect(readSecureField(line)).toContain(message)
    }

    // Native require bypasses Vite aliases, exactly like electron-log/main did.
    const require = createRequire(import.meta.url)
    expect(require.cache[require.resolve('electron')]).toBeUndefined()
  })
})
