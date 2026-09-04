// Mock for the `electron` module, used for every unit test via the `electron`
// alias in vitest.config.ts. Required, not just convenient: under plain Node
// (which is what Vitest runs on), `require('electron')`/`import ... from
// 'electron'` resolves to a *string* (the path to the Electron binary), not
// the { app, safeStorage, session, ... } object it is at runtime inside
// Electron itself — so every main-process module that does
// `import { app } from 'electron'` would otherwise blow up on import.
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { vi } from 'vitest'

let root = mkdtempSync(join(tmpdir(), 'applyer-test-'))
let pathCache: Record<string, string> = {}

/** Fresh userData/temp root and a cleared path cache — call between tests that touch the filesystem so they don't see each other's files. */
export function __resetElectronMock(): void {
  root = mkdtempSync(join(tmpdir(), 'applyer-test-'))
  pathCache = {}
  __encryptionAvailable = true
  __packaged = false
}

function getPath(name: string): string {
  if (!pathCache[name]) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    pathCache[name] = dir
  }
  return pathCache[name]
}

/**
 * Mirrors Electron's own behaviour: the override sticks for every later
 * getPath of that name, and the directory is NOT created as a side effect.
 */
function setPath(name: string, path: string): void {
  pathCache[name] = path
}

let __packaged = false

/** Test-only control for `app.isPackaged`, same rationale as `__setEncryptionAvailable`. */
export function __setPackaged(value: boolean): void {
  __packaged = value
}

export const app = {
  getPath,
  setPath,
  getAppPath: (): string => process.cwd(),
  getVersion: (): string => '0.0.0-test',
  get isPackaged(): boolean {
    return __packaged
  }
}

let __encryptionAvailable = true

/** Reversible stand-in for OS-keychain encryption — real enough to exercise the tag/format logic in db/encryption.ts without a real keyring. */
const ENC_MARKER = 'TEST_ENCRYPTED:'

export const safeStorage = {
  isEncryptionAvailable: (): boolean => __encryptionAvailable,
  encryptString: (value: string): Buffer => Buffer.from(ENC_MARKER + value, 'utf-8'),
  decryptString: (buffer: Buffer): string => {
    const str = buffer.toString('utf-8')
    if (!str.startsWith(ENC_MARKER)) throw new Error('Mock decryptString: not a value this mock encrypted')
    return str.slice(ENC_MARKER.length)
  }
}

/**
 * Test-only control, kept as a standalone export (not a property on the
 * `safeStorage` mock object) so tests can import it directly by relative
 * path — importing it via `from 'electron'` would type-check against the
 * *real* Electron SafeStorage type (which tsc resolves regardless of the
 * vitest bundler alias), and that type has no such property.
 */
export function __setEncryptionAvailable(value: boolean): void {
  __encryptionAvailable = value
}

export const session = {
  defaultSession: {
    webRequest: {
      onHeadersReceived: vi.fn()
    }
  }
}

/** Minimal notification/window surface for main-process notification tests and modules. */
export class Notification {
  static isSupported(): boolean {
    return true
  }

  readonly options: Electron.NotificationConstructorOptions

  constructor(options: Electron.NotificationConstructorOptions) {
    this.options = options
  }

  on(): this {
    return this
  }

  once(): this {
    return this
  }

  show(): void {
    void this.options
  }
}

export const BrowserWindow = {
  getAllWindows: (): Electron.BrowserWindow[] => []
}
