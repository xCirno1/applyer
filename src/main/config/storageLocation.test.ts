import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { __resetElectronMock } from '../../../test/mocks/electron'
import {
  pointerFilePath,
  readStorageLocationPointer,
  writeStorageLocationPointer,
  resolveActiveStorageRoot,
  activeStorageRoot,
  consumeStartupFallbackWarning,
  getStorageRecoveryState,
  clearStorageRecoveryState
} from './storageLocation'

beforeEach(() => {
  __resetElectronMock()
})

describe('readStorageLocationPointer', () => {
  it('returns the default pointer with no fallback reason when the file does not exist', () => {
    const { pointer, fallbackReason } = readStorageLocationPointer()
    expect(pointer).toEqual({ schemaVersion: 1, customRoot: null })
    expect(fallbackReason).toBeNull()
  })

  it('round-trips a written pointer', () => {
    writeStorageLocationPointer({ schemaVersion: 1, customRoot: '/some/custom/root' })
    const { pointer, fallbackReason } = readStorageLocationPointer()
    expect(pointer).toEqual({ schemaVersion: 1, customRoot: '/some/custom/root' })
    expect(fallbackReason).toBeNull()
  })

  it('falls back to the default pointer with a reason on corrupt JSON', () => {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(pointerFilePath(), '{ not valid json', 'utf-8')
    const { pointer, fallbackReason } = readStorageLocationPointer()
    expect(pointer).toEqual({ schemaVersion: 1, customRoot: null })
    expect(fallbackReason).not.toBeNull()
  })

  it('falls back to the default pointer with a reason on a malformed shape', () => {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(pointerFilePath(), JSON.stringify({ schemaVersion: 2, customRoot: 42 }), 'utf-8')
    const { pointer, fallbackReason } = readStorageLocationPointer()
    expect(pointer).toEqual({ schemaVersion: 1, customRoot: null })
    expect(fallbackReason).not.toBeNull()
  })

  it.each(['', 'relative/path'])('rejects a non-absolute custom root (%j)', (customRoot) => {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(pointerFilePath(), JSON.stringify({ schemaVersion: 1, customRoot }), 'utf-8')

    const { pointer, fallbackReason } = readStorageLocationPointer()

    expect(pointer).toEqual({ schemaVersion: 1, customRoot: null })
    expect(fallbackReason).not.toBeNull()
  })
})

describe('resolveActiveStorageRoot', () => {
  it('uses the OS-default userData dir when no pointer file exists', () => {
    resolveActiveStorageRoot()
    expect(activeStorageRoot()).toBe(app.getPath('userData'))
    expect(consumeStartupFallbackWarning()).toBeNull()
  })

  it('uses a valid, writable custom root that actually holds applyer.db', () => {
    const customRoot = mkdtempSync(join(tmpdir(), 'applyer-custom-root-'))
    writeFileSync(join(customRoot, 'applyer.db'), '')
    writeStorageLocationPointer({ schemaVersion: 1, customRoot })
    resolveActiveStorageRoot()
    expect(activeStorageRoot()).toBe(customRoot)
    expect(consumeStartupFallbackWarning()).toBeNull()
    rmSync(customRoot, { recursive: true, force: true })
  })

  it('falls back to the default root and requests recovery (not just a toast) when the custom root is missing', () => {
    const missingRoot = join(tmpdir(), 'applyer-missing-root-does-not-exist')
    writeStorageLocationPointer({ schemaVersion: 1, customRoot: missingRoot })
    resolveActiveStorageRoot()
    expect(activeStorageRoot()).toBe(app.getPath('userData'))
    // This branch is retryable (we know exactly which root to reconnect to),
    // so it must block via the stable recovery state, not the one-shot toast.
    expect(consumeStartupFallbackWarning()).toBeNull()
    const recovery = getStorageRecoveryState()
    expect(recovery.needed).toBe(true)
    expect(recovery.unavailableCustomRoot).toBe(missingRoot)
    expect(recovery.reason).toContain(missingRoot)
    // Stable, unlike the toast: a second read still reports it as needed.
    expect(getStorageRecoveryState().needed).toBe(true)
    clearStorageRecoveryState()
  })

  it('falls back to the default root and requests recovery when the custom root exists but has no applyer.db (e.g. an unmounted mount point)', () => {
    // A directory that exists and is writable on the local filesystem even
    // though nothing is actually mounted there — accessSync alone would
    // pass this, which is exactly the silent-blank-database scenario being
    // guarded against.
    const emptyMountPoint = mkdtempSync(join(tmpdir(), 'applyer-unmounted-'))
    writeStorageLocationPointer({ schemaVersion: 1, customRoot: emptyMountPoint })
    resolveActiveStorageRoot()
    expect(activeStorageRoot()).toBe(app.getPath('userData'))
    expect(consumeStartupFallbackWarning()).toBeNull()
    expect(getStorageRecoveryState()).toEqual({
      needed: true,
      reason: expect.any(String),
      unavailableCustomRoot: emptyMountPoint
    })
    clearStorageRecoveryState()
    rmSync(emptyMountPoint, { recursive: true, force: true })
  })

  it('does not request recovery for a corrupt pointer file — nothing concrete to retry, stays a one-shot toast', () => {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(pointerFilePath(), '{ not valid json', 'utf-8')
    resolveActiveStorageRoot()
    expect(activeStorageRoot()).toBe(app.getPath('userData'))
    expect(consumeStartupFallbackWarning()).not.toBeNull()
    expect(getStorageRecoveryState().needed).toBe(false)
  })

  it('does not request recovery when customRoot is null (intentionally using the default)', () => {
    writeStorageLocationPointer({ schemaVersion: 1, customRoot: null })
    resolveActiveStorageRoot()
    expect(activeStorageRoot()).toBe(app.getPath('userData'))
    expect(consumeStartupFallbackWarning()).toBeNull()
    expect(getStorageRecoveryState().needed).toBe(false)
  })
})
