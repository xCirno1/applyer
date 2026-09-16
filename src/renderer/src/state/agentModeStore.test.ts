// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getAgentMode = vi.fn()
const setAgentMode = vi.fn()
const onChangedHandlers: ((mode: unknown) => void)[] = []

beforeEach(() => {
  vi.resetModules()
  getAgentMode.mockReset()
  setAgentMode.mockReset()
  onChangedHandlers.length = 0
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      settings: {
        getAgentMode,
        setAgentMode,
        onAgentModeChanged: (fn: (mode: unknown) => void) => {
          onChangedHandlers.push(fn)
          return () => {
            const i = onChangedHandlers.indexOf(fn)
            if (i >= 0) onChangedHandlers.splice(i, 1)
          }
        }
      }
    }
  })
})

describe('agentModeStore', () => {
  it('loads the persisted mode', async () => {
    getAgentMode.mockResolvedValue('openrouter')
    const { useAgentModeStore } = await import('./agentModeStore')
    await useAgentModeStore.getState().load()
    expect(useAgentModeStore.getState().mode).toBe('openrouter')
    expect(useAgentModeStore.getState().loading).toBe(false)
  })

  it('ignores a malformed load result and keeps the previous mode', async () => {
    getAgentMode.mockResolvedValue('not-a-mode')
    const { useAgentModeStore } = await import('./agentModeStore')
    useAgentModeStore.setState({ mode: 'cli' })
    await useAgentModeStore.getState().load()
    expect(useAgentModeStore.getState().mode).toBe('cli')
  })

  it('setMode switches immediately and confirms on success', async () => {
    setAgentMode.mockResolvedValue({ ok: true, mode: 'openrouter' })
    const { useAgentModeStore } = await import('./agentModeStore')
    useAgentModeStore.setState({ mode: 'cli' })
    const promise = useAgentModeStore.getState().setMode('openrouter')
    expect(useAgentModeStore.getState().mode).toBe('openrouter')
    const result = await promise
    expect(result.ok).toBe(true)
    expect(useAgentModeStore.getState().mode).toBe('openrouter')
  })

  it('setMode reverts and records the error on failure', async () => {
    setAgentMode.mockResolvedValue({ ok: false, error: { code: 'invalidAgentMode' } })
    const { useAgentModeStore } = await import('./agentModeStore')
    useAgentModeStore.setState({ mode: 'cli' })
    const result = await useAgentModeStore.getState().setMode('openrouter')
    expect(result.ok).toBe(false)
    expect(useAgentModeStore.getState().mode).toBe('cli')
    expect(useAgentModeStore.getState().lastError).toEqual({ code: 'invalidAgentMode' })
  })

  it('setMode is a no-op when the mode is already current', async () => {
    const { useAgentModeStore } = await import('./agentModeStore')
    useAgentModeStore.setState({ mode: 'cli' })
    const result = await useAgentModeStore.getState().setMode('cli')
    expect(result.ok).toBe(true)
    expect(setAgentMode).not.toHaveBeenCalled()
  })

  it('reverts to a bridge failure error when the IPC call itself rejects', async () => {
    setAgentMode.mockRejectedValue(new Error('boom'))
    const { useAgentModeStore } = await import('./agentModeStore')
    useAgentModeStore.setState({ mode: 'cli' })
    const result = await useAgentModeStore.getState().setMode('openrouter')
    expect(result.ok).toBe(false)
    expect(useAgentModeStore.getState().mode).toBe('cli')
    expect(useAgentModeStore.getState().lastError?.code).toBe('unexpected')
  })

  it('clearError resets lastError', async () => {
    const { useAgentModeStore } = await import('./agentModeStore')
    useAgentModeStore.setState({ lastError: { code: 'unexpected' } })
    useAgentModeStore.getState().clearError()
    expect(useAgentModeStore.getState().lastError).toBeNull()
  })

  it('subscribe loads the mode and follows onAgentModeChanged pushes', async () => {
    getAgentMode.mockResolvedValue('cli')
    const { useAgentModeStore } = await import('./agentModeStore')
    const unsubscribe = useAgentModeStore.getState().subscribe()
    await Promise.resolve()
    await Promise.resolve()
    expect(useAgentModeStore.getState().mode).toBe('cli')

    onChangedHandlers.forEach((fn) => fn('openrouter'))
    expect(useAgentModeStore.getState().mode).toBe('openrouter')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    onChangedHandlers.forEach((fn) => fn('bogus'))
    expect(useAgentModeStore.getState().mode).toBe('openrouter')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

    unsubscribe()
  })
})
