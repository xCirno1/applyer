import { describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/types/ipcEvents'
import { createCloseGuard, type GuardableWindow } from './closeGuard'

function fakeWindow(): GuardableWindow & { closeAttempts: number; closed: number; sent: string[] } {
  let listener: ((event: { preventDefault(): void }) => void) | undefined
  const window = {
    closeAttempts: 0,
    closed: 0,
    sent: [] as string[],
    on: vi.fn((_event: 'close', next: (event: { preventDefault(): void }) => void) => {
      listener = next
    }),
    webContents: { send: (channel: string) => window.sent.push(channel) },
    close: () => {
      window.closeAttempts += 1
      let prevented = false
      listener?.({ preventDefault: () => (prevented = true) })
      if (!prevented) window.closed += 1
    }
  }
  return window
}

describe('closeGuard', () => {
  it('lets a window close when nothing is unsaved', () => {
    const guard = createCloseGuard()
    const window = fakeWindow()
    guard.attach(window)
    window.close()
    expect(window.closed).toBe(1)
    expect(window.sent).toEqual([])
  })

  it('cancels the close over unsaved changes and asks the renderer', () => {
    const guard = createCloseGuard()
    const window = fakeWindow()
    guard.attach(window)
    guard.setUnsavedChanges(true)
    window.close()
    expect(window.closed).toBe(0)
    expect(window.sent).toEqual([IPC.app.onCloseRequested])
    expect(guard.hasUnsavedChanges()).toBe(true)
  })

  it('closes once the renderer confirms, and again freely after a save clears the flag', () => {
    const guard = createCloseGuard()
    const window = fakeWindow()
    guard.attach(window)
    guard.setUnsavedChanges(true)
    window.close()
    guard.confirmClose(window)
    expect(window.closed).toBe(1)

    const other = fakeWindow()
    guard.attach(other)
    guard.setUnsavedChanges(false)
    other.close()
    expect(other.closed).toBe(1)
    expect(other.sent).toEqual([])
  })

  it('lets everything through once released', () => {
    const guard = createCloseGuard()
    const window = fakeWindow()
    guard.attach(window)
    guard.setUnsavedChanges(true)
    guard.release()
    window.close()
    expect(window.closed).toBe(1)
    expect(window.sent).toEqual([])
  })

  it('confirms only the window that asked', () => {
    const guard = createCloseGuard()
    const asked = fakeWindow()
    const bystander = fakeWindow()
    guard.attach(asked)
    guard.attach(bystander)
    guard.setUnsavedChanges(true)
    guard.confirmClose(asked)
    expect(asked.closed).toBe(1)
    bystander.close()
    expect(bystander.closed).toBe(0)
  })
})
