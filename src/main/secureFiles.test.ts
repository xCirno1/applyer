import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetElectronMock } from '../../test/mocks/electron'
import { screenshotsDir } from './config/paths'
import { readSecureFileBuffer } from './db/encryption'
import { rewriteScreenshotStorageMode } from './secureFiles'

beforeEach(() => __resetElectronMock())

describe('rewriteScreenshotStorageMode', () => {
  it('encrypts legacy screenshots and can decrypt them again', () => {
    const path = join(screenshotsDir(), 'job.png')
    const image = Buffer.from('private screenshot bytes')
    writeFileSync(path, image)

    rewriteScreenshotStorageMode('encrypted')
    const encrypted = readFileSync(path)
    expect(encrypted.equals(image)).toBe(false)
    expect(readSecureFileBuffer(encrypted)).toEqual(image)

    rewriteScreenshotStorageMode('plaintext')
    expect(readFileSync(path)).toEqual(image)
  })
})
