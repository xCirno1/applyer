import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
})

import {
  addDocument,
  listDocuments,
  getExtractedText,
  deleteDocument,
  readDocumentBytes,
  rewriteDocumentStorageMode
} from './documentsRepository'
import { setStorageMode } from './settingsRepository'
import { MAX_DOCUMENT_SIZE_BYTES } from '@shared/constants'

function textFile(content: string): { kind: 'resume'; originalFilename: string; mimeType: string; data: Buffer } {
  return { kind: 'resume' as const, originalFilename: 'resume.txt', mimeType: 'text/plain', data: Buffer.from(content, 'utf-8') }
}

describe('addDocument', () => {
  it('rejects an empty file', async () => {
    await expect(addDocument(textFile(''))).rejects.toThrow('File is empty')
  })

  it('rejects a file over the size limit', async () => {
    const oversized = Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES + 1, 'a')
    await expect(addDocument({ ...textFile(''), data: oversized })).rejects.toThrow(/size limit/)
  })

  it('extracts text from a plain-text file', async () => {
    const doc = await addDocument(textFile('  My resume content  '))
    expect(doc.hasExtractedText).toBe(true)
    expect(getExtractedText(doc.id)).toBe('My resume content')
  })

  it('returns no extracted text for an unrecognized mime type, without throwing', async () => {
    const doc = await addDocument({ kind: 'other', originalFilename: 'x.bin', mimeType: 'application/octet-stream', data: Buffer.from('binary') })
    expect(doc.hasExtractedText).toBe(false)
    expect(getExtractedText(doc.id)).toBeNull()
  })

  it('creates the profile row implicitly if one does not exist yet', async () => {
    const doc = await addDocument(textFile('content'))
    expect(doc.id).toBeTruthy()
    expect(listDocuments()).toHaveLength(1)
  })

  it('stores the file bytes recoverably via readDocumentBytes, in both storage modes', async () => {
    setStorageMode('encrypted')
    const encDoc = await addDocument(textFile('secret resume'))
    expect(readDocumentBytes(encDoc.id)?.toString('utf-8')).toBe('secret resume')

    setStorageMode('plaintext')
    const plainDoc = await addDocument(textFile('open resume'))
    expect(readDocumentBytes(plainDoc.id)?.toString('utf-8')).toBe('open resume')
  })
})

describe('listDocuments', () => {
  it('lists everything uploaded, most recent included', async () => {
    await addDocument(textFile('a'))
    await addDocument({ ...textFile('b'), kind: 'cover_letter', originalFilename: 'cover.txt' })
    expect(listDocuments()).toHaveLength(2)
  })

  it('is empty when nothing has been uploaded', () => {
    expect(listDocuments()).toEqual([])
  })
})

describe('getExtractedText / readDocumentBytes for unknown id', () => {
  it('return null rather than throwing', () => {
    expect(getExtractedText('nope')).toBeNull()
    expect(readDocumentBytes('nope')).toBeNull()
  })
})

describe('deleteDocument', () => {
  it('removes the row and the underlying file', async () => {
    const doc = await addDocument(textFile('content'))
    await deleteDocument(doc.id)
    expect(listDocuments()).toEqual([])
    expect(readDocumentBytes(doc.id)).toBeNull()
  })

  it('is a no-op for an unknown id', async () => {
    await expect(deleteDocument('nope')).resolves.not.toThrow()
  })
})

describe('rewriteDocumentStorageMode', () => {
  it('re-encrypts a plaintext document in place when switching to encrypted mode', async () => {
    setStorageMode('plaintext')
    const doc = await addDocument(textFile('sensitive content'))

    await rewriteDocumentStorageMode(doc.id, 'encrypted')

    expect(readDocumentBytes(doc.id)?.toString('utf-8')).toBe('sensitive content')
    expect(getExtractedText(doc.id)).toBe('sensitive content')
  })

  it('decrypts an encrypted document in place when switching to plaintext mode', async () => {
    setStorageMode('encrypted')
    const doc = await addDocument(textFile('sensitive content'))

    await rewriteDocumentStorageMode(doc.id, 'plaintext')

    expect(readDocumentBytes(doc.id)?.toString('utf-8')).toBe('sensitive content')
  })

  it('is a no-op for an unknown id', async () => {
    await expect(rewriteDocumentStorageMode('nope', 'plaintext')).resolves.not.toThrow()
  })
})
