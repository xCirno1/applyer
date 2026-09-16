import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertIntoChat, registerChatComposer, registerChatOpener, resetChatBridge } from './chatBridge'

beforeEach(() => resetChatBridge())

describe('chatBridge', () => {
  it('inserts straight into the active composer', () => {
    const insertText = vi.fn()
    registerChatComposer({ insertText })
    expect(insertIntoChat('hello')).toBe(true)
    expect(insertText).toHaveBeenCalledWith('hello')
  })

  it('reports failure when nothing is mounted', () => {
    expect(insertIntoChat('hello')).toBe(false)
    const insertText = vi.fn()
    registerChatComposer({ insertText })
    expect(insertText).not.toHaveBeenCalled()
  })

  it('opens the dock and delivers the text once a composer registers', () => {
    const open = vi.fn()
    registerChatOpener(open)
    expect(insertIntoChat('later')).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)

    const insertText = vi.fn()
    registerChatComposer({ insertText })
    expect(insertText).toHaveBeenCalledWith('later')

    // Delivered once: a later composer swap does not replay it.
    const other = vi.fn()
    registerChatComposer({ insertText: other })
    expect(other).not.toHaveBeenCalled()
  })

  it('keeps only the latest waiting text', () => {
    registerChatOpener(() => undefined)
    insertIntoChat('first')
    insertIntoChat('second')
    const insertText = vi.fn()
    registerChatComposer({ insertText })
    expect(insertText).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('second')
  })

  it('goes back to failing once the dock unregisters', () => {
    registerChatOpener(() => undefined)
    registerChatComposer({ insertText: () => undefined })
    registerChatComposer(null)
    registerChatOpener(null)
    expect(insertIntoChat('x')).toBe(false)
  })
})
