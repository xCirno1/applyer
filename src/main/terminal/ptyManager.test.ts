import { describe, it, expect, vi, beforeEach } from 'vitest'

// node-pty is a native addon that spawns a real shell — mocked at the module
// boundary so these tests exercise the session bookkeeping (which is all this
// module is) without a process per test.
const spawned: MockPty[] = []

interface MockPty {
  args: { file: string; options: Record<string, unknown> }
  written: string[]
  resizes: Array<[number, number]>
  killed: boolean
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
}

vi.mock('node-pty', () => ({
  spawn: (file: string, _args: string[], options: Record<string, unknown>) => {
    let onData: (data: string) => void = () => {}
    let onExit: (event: { exitCode: number }) => void = () => {}
    const pty: MockPty = {
      args: { file, options },
      written: [],
      resizes: [],
      killed: false,
      emitData: (data) => onData(data),
      emitExit: (exitCode) => onExit({ exitCode })
    }
    spawned.push(pty)
    return {
      onData: (cb: (data: string) => void) => {
        onData = cb
      },
      onExit: (cb: (event: { exitCode: number }) => void) => {
        onExit = cb
      },
      write: (data: string) => pty.written.push(data),
      resize: (cols: number, rows: number) => pty.resizes.push([cols, rows]),
      kill: () => {
        pty.killed = true
      }
    }
  }
}))

const getAutoStartCommand = vi.fn<() => string>(() => '')
vi.mock('../db/repositories/settingsRepository', () => ({
  getAutoStartCommand: () => getAutoStartCommand()
}))

import {
  createSession,
  writeToSession,
  resizeSession,
  disposeSession,
  disposeAllSessions
} from './ptyManager'

const latest = (): MockPty => {
  const pty = spawned[spawned.length - 1]
  if (!pty) throw new Error('No pty was spawned')
  return pty
}

beforeEach(() => {
  disposeAllSessions()
  spawned.length = 0
  getAutoStartCommand.mockReturnValue('')
})

describe('createSession', () => {
  it('returns a distinct id per session and spawns one pty for each', () => {
    const first = createSession(80, 24, vi.fn(), vi.fn())
    const second = createSession(80, 24, vi.fn(), vi.fn())

    expect(first).not.toBe(second)
    expect(spawned).toHaveLength(2)
  })

  it('runs the shell in the agent workspace, not the user home directory', () => {
    createSession(80, 24, vi.fn(), vi.fn())
    expect(String(latest().args.options.cwd)).toContain('workspace')
  })

  // Guards against a NaN/0/negative size reaching node-pty, which rejects it.
  it.each([
    [Number.NaN, Number.NaN, 80, 24],
    [0, 0, 80, 24],
    [-5, -5, 1, 1],
    [100.7, 40.2, 100, 40]
  ])('clamps cols/rows %s x %s to %s x %s', (cols, rows, expectedCols, expectedRows) => {
    createSession(cols, rows, vi.fn(), vi.fn())
    expect(latest().args.options.cols).toBe(expectedCols)
    expect(latest().args.options.rows).toBe(expectedRows)
  })

  it('forwards pty output to the data callback', () => {
    const onData = vi.fn()
    createSession(80, 24, onData, vi.fn())

    latest().emitData('hello')

    expect(onData).toHaveBeenCalledWith('hello')
  })

  it('reports the exit code and forgets the session, so later writes are no-ops', () => {
    const onExit = vi.fn()
    const id = createSession(80, 24, vi.fn(), onExit)

    latest().emitExit(130)

    expect(onExit).toHaveBeenCalledWith(130)
    writeToSession(id, 'ignored')
    expect(latest().written).toEqual([])
  })

  it('types the configured auto-start command into the new shell', () => {
    getAutoStartCommand.mockReturnValue('claude')
    createSession(80, 24, vi.fn(), vi.fn())
    expect(latest().written).toEqual(['claude\r'])
  })

  it('types nothing when no auto-start command is configured', () => {
    createSession(80, 24, vi.fn(), vi.fn())
    expect(latest().written).toEqual([])
  })
})

describe('writeToSession', () => {
  it('writes to the addressed session only', () => {
    const first = createSession(80, 24, vi.fn(), vi.fn())
    const firstPty = latest()
    createSession(80, 24, vi.fn(), vi.fn())

    writeToSession(first, 'ls\r')

    expect(firstPty.written).toEqual(['ls\r'])
    expect(latest().written).toEqual([])
  })

  // A renderer holding an id for a session that has since exited is ordinary,
  // not exceptional — it must not throw its way out of the IPC handler.
  it('ignores an unknown session id', () => {
    expect(() => writeToSession('does-not-exist', 'ls\r')).not.toThrow()
  })
})

describe('resizeSession', () => {
  it('resizes the addressed session', () => {
    const id = createSession(80, 24, vi.fn(), vi.fn())
    resizeSession(id, 120, 40)
    expect(latest().resizes).toEqual([[120, 40]])
  })

  it('clamps a nonsense size rather than passing it through', () => {
    const id = createSession(80, 24, vi.fn(), vi.fn())
    resizeSession(id, Number.NaN, 0)
    expect(latest().resizes).toEqual([[80, 24]])
  })

  it('ignores an unknown session id', () => {
    expect(() => resizeSession('does-not-exist', 120, 40)).not.toThrow()
  })

  // node-pty throws if the pty is already gone; a failed resize is cosmetic
  // and must not surface as an IPC error.
  it('survives a pty that refuses the resize', () => {
    const id = createSession(80, 24, vi.fn(), vi.fn())
    const pty = latest()
    pty.resizes.push = () => {
      throw new Error('ioctl failed')
    }
    expect(() => resizeSession(id, 120, 40)).not.toThrow()
  })
})

describe('disposeSession', () => {
  it('kills the pty and forgets the session', () => {
    const id = createSession(80, 24, vi.fn(), vi.fn())
    const pty = latest()

    disposeSession(id)

    expect(pty.killed).toBe(true)
    writeToSession(id, 'ignored')
    expect(pty.written).toEqual([])
  })

  it('is idempotent, so a second dispose from the renderer is harmless', () => {
    const id = createSession(80, 24, vi.fn(), vi.fn())
    disposeSession(id)
    expect(() => disposeSession(id)).not.toThrow()
  })

  it('ignores an unknown session id', () => {
    expect(() => disposeSession('does-not-exist')).not.toThrow()
  })
})

describe('disposeAllSessions', () => {
  it('kills every live session', () => {
    createSession(80, 24, vi.fn(), vi.fn())
    const first = latest()
    createSession(80, 24, vi.fn(), vi.fn())
    const second = latest()

    disposeAllSessions()

    expect([first.killed, second.killed]).toEqual([true, true])
  })

  it('is safe with no sessions open', () => {
    expect(() => disposeAllSessions()).not.toThrow()
  })
})
