import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '@shared/types/ipcEvents'
import {
  __invokeIpc,
  __sendIpc,
  __ipcListenerCount,
  __resetIpcMock
} from '../../../test/mocks/electron'

const createSession = vi.fn<
  (cols: number, rows: number, onData: (d: string) => void, onExit: (c: number) => void) => string
>()
const writeToSession = vi.fn()
const resizeSession = vi.fn()
const disposeSession = vi.fn()

vi.mock('../terminal/ptyManager', () => ({
  createSession: (...args: unknown[]) => createSession(...(args as Parameters<typeof createSession>)),
  writeToSession: (...args: unknown[]) => writeToSession(...args),
  resizeSession: (...args: unknown[]) => resizeSession(...args),
  disposeSession: (...args: unknown[]) => disposeSession(...args)
}))

import { registerTerminalIpc, setTerminalTarget } from './terminal'

function fakeWebContents(): { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean; destroyed: boolean } {
  return {
    send: vi.fn(),
    destroyed: false,
    isDestroyed(): boolean {
      return this.destroyed
    }
  }
}

type WebContentsArg = Parameters<typeof setTerminalTarget>[0]

beforeEach(() => {
  __resetIpcMock()
  createSession.mockReset()
  createSession.mockReturnValue('session-1')
  writeToSession.mockReset()
  resizeSession.mockReset()
  disposeSession.mockReset()
})

describe('registerTerminalIpc', () => {
  // The bug this guards: registration used to take the window's WebContents,
  // so it was called again for the window macOS creates on `activate`. The
  // real `ipcMain.handle` throws on a second handler for a channel (the mock
  // mirrors that), and `ipcMain.on` would have stacked a second listener that
  // writes every keystroke to the pty twice.
  it('registers handlers once per process, independent of any window', () => {
    registerTerminalIpc()
    setTerminalTarget(fakeWebContents() as unknown as WebContentsArg)
    setTerminalTarget(fakeWebContents() as unknown as WebContentsArg)

    expect(__ipcListenerCount(IPC.terminal.write)).toBe(1)
    expect(__ipcListenerCount(IPC.terminal.resize)).toBe(1)
    expect(__ipcListenerCount(IPC.terminal.dispose)).toBe(1)
  })

  it('creates a session with the requested size', () => {
    registerTerminalIpc()
    expect(__invokeIpc(IPC.terminal.create, { cols: 100, rows: 40 })).toEqual({ sessionId: 'session-1' })
    expect(createSession).toHaveBeenCalledWith(100, 40, expect.any(Function), expect.any(Function))
  })

  it.each([
    ['a missing payload', undefined],
    ['an empty payload', {}],
    ['non-numeric sizes', { cols: 'wide', rows: null }]
  ])('falls back to 80x24 for %s', (_label, payload) => {
    registerTerminalIpc()
    __invokeIpc(IPC.terminal.create, payload)
    expect(createSession).toHaveBeenCalledWith(80, 24, expect.any(Function), expect.any(Function))
  })

  it('forwards writes, resizes and disposes to the pty manager', () => {
    registerTerminalIpc()

    __sendIpc(IPC.terminal.write, 'session-1', 'ls\r')
    __sendIpc(IPC.terminal.resize, 'session-1', 120, 40)
    __sendIpc(IPC.terminal.dispose, 'session-1')

    expect(writeToSession).toHaveBeenCalledWith('session-1', 'ls\r')
    expect(resizeSession).toHaveBeenCalledWith('session-1', 120, 40)
    expect(disposeSession).toHaveBeenCalledWith('session-1')
  })

  it('drops writes whose session id or data is not a string', () => {
    registerTerminalIpc()

    __sendIpc(IPC.terminal.write, 42, 'ls\r')
    __sendIpc(IPC.terminal.write, 'session-1', { toString: () => 'ls' })

    expect(writeToSession).not.toHaveBeenCalled()
  })

  it('coerces resize dimensions, leaving the clamping to the pty manager', () => {
    registerTerminalIpc()
    __sendIpc(IPC.terminal.resize, 'session-1', '120', '40')
    expect(resizeSession).toHaveBeenCalledWith('session-1', 120, 40)
  })
})

describe('terminal output target', () => {
  it('sends output and exit to the current window', () => {
    registerTerminalIpc()
    const webContents = fakeWebContents()
    setTerminalTarget(webContents as unknown as WebContentsArg)

    __invokeIpc(IPC.terminal.create, { cols: 80, rows: 24 })
    const [, , onData, onExit] = createSession.mock.calls[0]!
    onData('output')
    onExit(0)

    expect(webContents.send).toHaveBeenCalledWith(IPC.terminal.onData, {
      sessionId: 'session-1',
      data: 'output'
    })
    expect(webContents.send).toHaveBeenCalledWith(IPC.terminal.onExit, {
      sessionId: 'session-1',
      exitCode: 0
    })
  })

  // Read at send time, not captured at create time: on macOS a session can
  // outlive the window it was created for, and its output has to reach the
  // replacement rather than a destroyed WebContents.
  it('follows the target to a new window', () => {
    registerTerminalIpc()
    const first = fakeWebContents()
    setTerminalTarget(first as unknown as WebContentsArg)

    __invokeIpc(IPC.terminal.create, { cols: 80, rows: 24 })
    const [, , onData] = createSession.mock.calls[0]!

    const second = fakeWebContents()
    setTerminalTarget(second as unknown as WebContentsArg)
    onData('after reopen')

    expect(first.send).not.toHaveBeenCalled()
    expect(second.send).toHaveBeenCalledWith(IPC.terminal.onData, {
      sessionId: 'session-1',
      data: 'after reopen'
    })
  })

  it('drops output rather than throwing when the window is gone', () => {
    registerTerminalIpc()
    const webContents = fakeWebContents()
    setTerminalTarget(webContents as unknown as WebContentsArg)

    __invokeIpc(IPC.terminal.create, { cols: 80, rows: 24 })
    const [, , onData] = createSession.mock.calls[0]!
    webContents.destroyed = true

    expect(() => onData('output')).not.toThrow()
    expect(webContents.send).not.toHaveBeenCalled()
  })
})
