import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { removeFile, removeMaterializedDocument } from './attachmentCleanup'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'applyer-cleanup-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('removeFile', () => {
  it('removes only the file and tolerates a missing one', () => {
    const dir = join(root, 'screenshots')
    mkdirSync(dir)
    const gone = join(dir, 'a.png')
    const kept = join(dir, 'b.png')
    writeFileSync(gone, 'a')
    writeFileSync(kept, 'b')

    removeFile(gone)
    removeFile(gone)
    removeFile(undefined)

    expect(existsSync(gone)).toBe(false)
    expect(existsSync(kept)).toBe(true)
    expect(existsSync(dir)).toBe(true)
  })
})

describe('removeMaterializedDocument', () => {
  it('removes a rendered resume together with its per-render folder', () => {
    const temp = join(root, 'temp')
    const renderDir = join(temp, 'render-1')
    mkdirSync(renderDir, { recursive: true })
    const pdf = join(renderDir, 'Alex Morgan - Resume.pdf')
    writeFileSync(pdf, '%PDF')

    removeMaterializedDocument(pdf, temp)

    expect(existsSync(pdf)).toBe(false)
    expect(existsSync(renderDir)).toBe(false)
    expect(existsSync(temp)).toBe(true)
  })

  it('leaves the temp root alone for a document written directly into it', () => {
    const temp = join(root, 'temp')
    mkdirSync(temp, { recursive: true })
    const upload = join(temp, 'upload.pdf')
    const other = join(temp, 'other.pdf')
    writeFileSync(upload, '%PDF')
    writeFileSync(other, '%PDF')

    removeMaterializedDocument(upload, temp)

    expect(existsSync(upload)).toBe(false)
    expect(existsSync(other)).toBe(true)
    expect(existsSync(temp)).toBe(true)
  })

  it('never removes a folder outside the temp root', () => {
    const temp = join(root, 'temp')
    const screenshots = join(root, 'storage', 'screenshots')
    mkdirSync(temp, { recursive: true })
    mkdirSync(screenshots, { recursive: true })
    const obsolete = join(screenshots, 'job-2.png')
    const persisted = join(screenshots, 'other-job.png')
    writeFileSync(obsolete, 'png')
    writeFileSync(persisted, 'png')

    removeMaterializedDocument(obsolete, temp)

    expect(existsSync(obsolete)).toBe(false)
    expect(existsSync(persisted)).toBe(true)
    expect(existsSync(screenshots)).toBe(true)
  })
})
