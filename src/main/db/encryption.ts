import { safeStorage } from 'electron'

const ENCRYPTED_PREFIX = 'enc:v1:'

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * Encrypts (or passes through) a value for storage, tagged with a format
 * marker so reads never depend on the *current* storage-mode setting —
 * only on what the stored value actually is. Falls back to plaintext with
 * no tag if encryption is unavailable on this platform (e.g. no OS keyring),
 * so writes never silently fail.
 */
export function writeSecureField(value: string | null, mode: 'encrypted' | 'plaintext'): string | null {
  if (value === null) return null
  if (mode === 'plaintext' || !safeStorage.isEncryptionAvailable()) return value
  const encrypted = safeStorage.encryptString(value)
  return ENCRYPTED_PREFIX + encrypted.toString('base64')
}

export function readSecureField(raw: string | null): string | null {
  if (raw === null) return null
  if (!raw.startsWith(ENCRYPTED_PREFIX)) return raw
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This data was encrypted, but encrypted storage is unavailable on this system right now (no OS keyring?). It cannot be read until that changes.'
    )
  }
  const buffer = Buffer.from(raw.slice(ENCRYPTED_PREFIX.length), 'base64')
  return safeStorage.decryptString(buffer)
}

export function writeSecureBuffer(value: Buffer, mode: 'encrypted' | 'plaintext'): { data: Buffer; isEncrypted: boolean } {
  if (mode === 'plaintext' || !safeStorage.isEncryptionAvailable()) {
    return { data: value, isEncrypted: false }
  }
  return { data: safeStorage.encryptString(value.toString('base64')), isEncrypted: true }
}

export function readSecureBuffer(data: Buffer, isEncrypted: boolean): Buffer {
  if (!isEncrypted) return data
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This file was encrypted, but encrypted storage is unavailable on this system right now (no OS keyring?). It cannot be read until that changes.'
    )
  }
  const base64 = safeStorage.decryptString(data)
  return Buffer.from(base64, 'base64')
}
