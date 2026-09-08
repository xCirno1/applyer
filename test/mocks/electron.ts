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
  __storageBackend = 'gnome_libsecret'
  __packaged = false
  __resetIpcMock()
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

type StorageBackend = ReturnType<(typeof import('electron'))['safeStorage']['getSelectedStorageBackend']>

let __encryptionAvailable = true
let __storageBackend: StorageBackend = 'gnome_libsecret'

/** Reversible stand-in for OS-keychain encryption — real enough to exercise the tag/format logic in db/encryption.ts without a real keyring. */
const ENC_MARKER = 'TEST_ENCRYPTED:'

export const safeStorage = {
  isEncryptionAvailable: (): boolean => __encryptionAvailable,
  getSelectedStorageBackend: (): StorageBackend => __storageBackend,
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

export function __setStorageBackend(value: StorageBackend): void {
  __storageBackend = value
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

  close(): void {
    void this.options
  }
}

export const BrowserWindow = {
  getAllWindows: (): Electron.BrowserWindow[] => []
}


// --- ipcMain -------------------------------------------------------------
//
// Registration is modelled on the real thing rather than simplified, because
// the difference is load-bearing: Electron's `ipcMain.handle` *throws* on a
// second handler for the same channel, it does not overwrite. A mock that
// quietly overwrote would hide exactly the class of bug a test here is meant
// to catch (a register function called once per window instead of once per
// process). `on` appends, as it does in Electron, so a double registration
// shows up as a listener called twice rather than as an error.

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const ipcHandlers = new Map<string, IpcHandler>()
const ipcListeners = new Map<string, IpcHandler[]>()

export const ipcMain = {
  handle(channel: string, handler: IpcHandler): void {
    if (ipcHandlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`)
    }
    ipcHandlers.set(channel, handler)
  },
  removeHandler(channel: string): void {
    ipcHandlers.delete(channel)
  },
  on(channel: string, listener: IpcHandler): void {
    const existing = ipcListeners.get(channel) ?? []
    existing.push(listener)
    ipcListeners.set(channel, existing)
  },
  removeAllListeners(channel?: string): void {
    if (channel === undefined) ipcListeners.clear()
    else ipcListeners.delete(channel)
  }
}

/** Calls the `handle` handler for a channel, the way `ipcRenderer.invoke` would. Throws if nothing is registered — the same "no handler" failure the renderer would see. */
export function __invokeIpc(channel: string, ...args: unknown[]): unknown {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for '${channel}'`)
  return handler({ sender: {} }, ...args)
}

/** Fires every `on` listener for a channel, the way `ipcRenderer.send` would. Unlike invoke, a channel with no listeners is a no-op, not an error. */
export function __sendIpc(channel: string, ...args: unknown[]): void {
  for (const listener of ipcListeners.get(channel) ?? []) listener({ sender: {} }, ...args)
}

/** True if a `handle` handler is registered — for asserting registration itself, without invoking anything. */
export function __hasIpcHandler(channel: string): boolean {
  return ipcHandlers.has(channel)
}

/** How many `on` listeners a channel has. A double-registered `ipcMain.on` is invisible otherwise. */
export function __ipcListenerCount(channel: string): number {
  return (ipcListeners.get(channel) ?? []).length
}

export function __resetIpcMock(): void {
  ipcHandlers.clear()
  ipcListeners.clear()
}
