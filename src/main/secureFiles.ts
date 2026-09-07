import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageMode } from '@shared/types/profile'
import { screenshotsDir } from './config/paths'
import { readSecureFileBuffer, writeSecureFileBuffer } from './db/encryption'

/** Rewrites all persisted screenshots, including plaintext files from older releases. */
export function rewriteScreenshotStorageMode(mode: StorageMode): void {
  const dir = screenshotsDir()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    const plain = readSecureFileBuffer(readFileSync(path))
    writeFileSync(path, writeSecureFileBuffer(plain, mode), { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}
