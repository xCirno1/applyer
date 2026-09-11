import { safeStorage } from 'electron'

const ENCRYPTED_PREFIX = 'enc:v1:'
const ENCRYPTED_FILE_PREFIX = Buffer.from('applyer:enc:v1:\n', 'utf-8')

export function isEncryptionAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  // Electron's Linux `basic_text` fallback only obfuscates with a hard-coded
  // password. Presenting that as encryption would be materially misleading.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

/**
 * Encrypts (or passes through) a value for storage, tagged with a format
 * marker so reads never depend on the *current* storage-mode setting —
 * only on what the stored value actually is. Encrypted mode fails closed:
 * an unavailable keychain is an error, never permission to write plaintext.
 */
export function writeSecureField(value: string | null, mode: 'encrypted' | 'plaintext'): string | null {
  if (value === null) return null
  if (mode === 'plaintext') return value
  if (!isEncryptionAvailable()) {
    throw new Error('Encrypted storage was requested, but no secure OS keychain is available.')
  }
  const encrypted = safeStorage.encryptString(value)
  return ENCRYPTED_PREFIX + encrypted.toString('base64')
}

export function readSecureField(raw: string | null): string | null {
  if (raw === null) return null
  if (!raw.startsWith(ENCRYPTED_PREFIX)) return raw
  if (!isEncryptionAvailable()) {
    throw new Error(
      'This data was encrypted, but encrypted storage is unavailable on this system right now (no OS keyring?). It cannot be read until that changes.'
    )
  }
  const buffer = Buffer.from(raw.slice(ENCRYPTED_PREFIX.length), 'base64')
  return safeStorage.decryptString(buffer)
}

export function writeSecureBuffer(value: Buffer, mode: 'encrypted' | 'plaintext'): { data: Buffer; isEncrypted: boolean } {
  if (mode === 'plaintext') {
    return { data: value, isEncrypted: false }
  }
  if (!isEncryptionAvailable()) {
    throw new Error('Encrypted storage was requested, but no secure OS keychain is available.')
  }
  return { data: safeStorage.encryptString(value.toString('base64')), isEncrypted: true }
}

export function readSecureBuffer(data: Buffer, isEncrypted: boolean): Buffer {
  if (!isEncrypted) return data
  if (!isEncryptionAvailable()) {
    throw new Error(
      'This file was encrypted, but encrypted storage is unavailable on this system right now (no OS keyring?). It cannot be read until that changes.'
    )
  }
  const base64 = safeStorage.decryptString(data)
  return Buffer.from(base64, 'base64')
}

/** Self-describing encryption for files that do not have a companion DB flag (screenshots). */
export function writeSecureFileBuffer(value: Buffer, mode: 'encrypted' | 'plaintext'): Buffer {
  const written = writeSecureBuffer(value, mode)
  return written.isEncrypted ? Buffer.concat([ENCRYPTED_FILE_PREFIX, written.data]) : written.data
}

export function readSecureFileBuffer(data: Buffer): Buffer {
  if (!data.subarray(0, ENCRYPTED_FILE_PREFIX.length).equals(ENCRYPTED_FILE_PREFIX)) return data
  return readSecureBuffer(data.subarray(ENCRYPTED_FILE_PREFIX.length), true)
}
