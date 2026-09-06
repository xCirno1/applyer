import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { __resetElectronMock } from '../../../test/mocks/electron'
import { purgeTempDir, tempDir } from './paths'

beforeEach(() => {
  __resetElectronMock()
})

describe('tempDir', () => {
  it('creates the directory on first use', () => {
    expect(existsSync(tempDir())).toBe(true)
  })
})

describe('purgeTempDir', () => {
  // What accumulates here is decrypted: `fillTaskRunner` writes the resume out
  // in the clear for Playwright to upload by path, and only deletes it in a
  // `finally` that a crash skips.
  it('removes files left behind by an interrupted fill', () => {
    const leftover = join(tempDir(), 'leftover-resume.pdf')
    writeFileSync(leftover, 'decrypted resume bytes')

    purgeTempDir()

    expect(existsSync(leftover)).toBe(false)
  })

  it('removes nested leftovers too', () => {
    const nested = join(tempDir(), 'nested')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'cover-letter.pdf'), 'bytes')

    purgeTempDir()

    expect(existsSync(nested)).toBe(false)
  })

  it('leaves a usable, empty temp directory behind', () => {
    writeFileSync(join(tempDir(), 'a.pdf'), 'bytes')

    purgeTempDir()

    // tempDir() recreates on demand, so the next fill has somewhere to write.
    expect(readdirSync(tempDir())).toEqual([])
  })

  it('is safe when the directory was never created', () => {
    expect(() => purgeTempDir()).not.toThrow()
  })

  it('is safe to call twice', () => {
    purgeTempDir()
    expect(() => purgeTempDir()).not.toThrow()
  })
})
