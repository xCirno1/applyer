import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pasteIntoTerminal, registerActiveTerminal, registerTerminalOpener, resetTerminalBridge } from './terminalBridge'

beforeEach(() => resetTerminalBridge())

describe('terminalBridge', () => {
  it('pastes straight into the active terminal', () => {
    const paste = vi.fn()
    registerActiveTerminal({ paste })
    expect(pasteIntoTerminal('hello')).toBe(true)
    expect(paste).toHaveBeenCalledWith('hello')
  })

  it('reports failure when nothing is mounted', () => {
    expect(pasteIntoTerminal('hello')).toBe(false)
    const paste = vi.fn()
    registerActiveTerminal({ paste })
    expect(paste).not.toHaveBeenCalled()
  })

  it('opens a terminal and delivers the text once a pane registers', () => {
    const open = vi.fn()
    registerTerminalOpener(open)
    expect(pasteIntoTerminal('later')).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)

    const paste = vi.fn()
    registerActiveTerminal({ paste })
    expect(paste).toHaveBeenCalledWith('later')

    // Delivered once: a later pane switch does not replay it.
    const other = vi.fn()
    registerActiveTerminal({ other, paste: other } as unknown as { paste: (text: string) => void })
    expect(other).not.toHaveBeenCalled()
  })

  it('keeps only the latest waiting text', () => {
    registerTerminalOpener(() => undefined)
    pasteIntoTerminal('first')
    pasteIntoTerminal('second')
    const paste = vi.fn()
    registerActiveTerminal({ paste })
    expect(paste).toHaveBeenCalledTimes(1)
    expect(paste).toHaveBeenCalledWith('second')
  })

  it('goes back to failing once the group unregisters', () => {
    registerTerminalOpener(() => undefined)
    registerActiveTerminal({ paste: () => undefined })
    registerActiveTerminal(null)
    registerTerminalOpener(null)
    expect(pasteIntoTerminal('x')).toBe(false)
  })
})
