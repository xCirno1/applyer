import { describe, it, expect, beforeEach } from 'vitest'
import {
  __resetElectronMock,
  __setEncryptionAvailable,
  __setStorageBackend
} from '../../../test/mocks/electron'
import {
  isEncryptionAvailable,
  writeSecureField,
  readSecureField,
  writeSecureBuffer,
  readSecureBuffer,
  writeSecureFileBuffer,
  readSecureFileBuffer
} from './encryption'

beforeEach(() => {
  __resetElectronMock()
})

describe('isEncryptionAvailable', () => {
  it('reflects safeStorage.isEncryptionAvailable()', () => {
    expect(isEncryptionAvailable()).toBe(true)
    __setEncryptionAvailable(false)
    expect(isEncryptionAvailable()).toBe(false)
  })

  it('rejects Electron basic_text on Linux because it is not secure encryption', () => {
    if (process.platform !== 'linux') return
    __setStorageBackend('basic_text')
    expect(isEncryptionAvailable()).toBe(false)
  })
})

describe('writeSecureField / readSecureField', () => {
  it('round-trips a value through encrypted mode with a version-tagged prefix', () => {
    const stored = writeSecureField('secret value', 'encrypted')
    expect(stored).toMatch(/^enc:v1:/)
    expect(readSecureField(stored)).toBe('secret value')
  })

  it('stores plaintext (no prefix) when mode is plaintext', () => {
    const stored = writeSecureField('plain value', 'plaintext')
    expect(stored).toBe('plain value')
    expect(readSecureField(stored)).toBe('plain value')
  })

  it('passes null through untouched in either mode', () => {
    expect(writeSecureField(null, 'encrypted')).toBeNull()
    expect(writeSecureField(null, 'plaintext')).toBeNull()
    expect(readSecureField(null)).toBeNull()
  })

  it('fails closed when encryption is requested but unavailable', () => {
    __setEncryptionAvailable(false)
    expect(() => writeSecureField('secret value', 'encrypted')).toThrow(/no secure OS keychain/)
  })

  it('reads a value written before encryption became unavailable and throws a clear error', () => {
    const stored = writeSecureField('secret value', 'encrypted')
    __setEncryptionAvailable(false)
    expect(() => readSecureField(stored)).toThrow(/encrypted storage is unavailable/)
  })

  it('reads a plain (unprefixed) value as-is even when the current mode is encrypted', () => {
    expect(readSecureField('legacy plaintext value')).toBe('legacy plaintext value')
  })
})

describe('writeSecureBuffer / readSecureBuffer', () => {
  it('round-trips a buffer through encrypted mode and marks isEncrypted true', () => {
    const original = Buffer.from('binary file contents', 'utf-8')
    const { data, isEncrypted } = writeSecureBuffer(original, 'encrypted')
    expect(isEncrypted).toBe(true)
    expect(data.equals(original)).toBe(false)
    expect(readSecureBuffer(data, true).toString('utf-8')).toBe('binary file contents')
  })

  it('leaves the buffer untouched in plaintext mode and marks isEncrypted false', () => {
    const original = Buffer.from('binary file contents', 'utf-8')
    const { data, isEncrypted } = writeSecureBuffer(original, 'plaintext')
    expect(isEncrypted).toBe(false)
    expect(data.equals(original)).toBe(true)
    expect(readSecureBuffer(data, false).equals(original)).toBe(true)
  })

  it('fails closed when buffer encryption is unavailable', () => {
    __setEncryptionAvailable(false)
    const original = Buffer.from('binary file contents', 'utf-8')
    expect(() => writeSecureBuffer(original, 'encrypted')).toThrow(/no secure OS keychain/)
  })

  it('throws a clear error reading an encrypted buffer when encryption is currently unavailable', () => {
    const original = Buffer.from('binary file contents', 'utf-8')
    const { data } = writeSecureBuffer(original, 'encrypted')
    __setEncryptionAvailable(false)
    expect(() => readSecureBuffer(data, true)).toThrow(/encrypted storage is unavailable/)
  })
})

describe('self-describing encrypted files', () => {
  it('round-trips encrypted files without a separate flag', () => {
    const raw = Buffer.from('image bytes')
    const stored = writeSecureFileBuffer(raw, 'encrypted')
    expect(stored.equals(raw)).toBe(false)
    expect(readSecureFileBuffer(stored)).toEqual(raw)
  })

  it('keeps plaintext-mode files readable', () => {
    const raw = Buffer.from('image bytes')
    expect(readSecureFileBuffer(writeSecureFileBuffer(raw, 'plaintext'))).toEqual(raw)
  })
})
