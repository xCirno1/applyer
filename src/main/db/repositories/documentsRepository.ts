import { randomUUID } from 'crypto'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { documents, profile } from '../schema'
import { readSecureBuffer, readSecureField, writeSecureBuffer, writeSecureField } from '../encryption'
import { getStorageMode } from './settingsRepository'
import { documentsDir } from '../../config/paths'
import { logActivity } from './activityLogRepository'
import { PROFILE_ID } from './profileRepository'
import { withStorageWriteLock } from '../../storageWriteLock'
import type { DocumentKind, DocumentSummary, StorageMode } from '@shared/types/profile'
import { MAX_DOCUMENT_SIZE_BYTES } from '@shared/constants'

type DocumentRow = typeof documents.$inferSelect

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    kind: row.kind,
    originalFilename: row.originalFilename,
    sizeBytes: row.sizeBytes,
    hasExtractedText: !!row.extractedText,
    createdAt: row.createdAt
  }
}

async function extractText(mimeType: string, data: Buffer): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(data) })
      const result = await parser.getText()
      return result.text?.trim() || null
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: data })
      return result.value?.trim() || null
    }
    if (mimeType === 'text/plain') {
      return data.toString('utf-8').trim() || null
    }
    return null
  } catch (err) {
    logActivity('warn', `Failed to extract text from uploaded document (${mimeType})`, {
      error: String(err)
    })
    return null
  }
}

/** Ensures a profile row exists so `documents.profileId` has something to reference. */
function ensureProfileRow(): void {
  const db = getDb()
  const existing = db.select({ id: profile.id }).from(profile).where(eq(profile.id, PROFILE_ID)).get()
  if (existing) return
  const now = new Date().toISOString()
  db.insert(profile)
    .values({ id: PROFILE_ID, remotePreference: 'no_preference', createdAt: now, updatedAt: now })
    .run()
}

export interface AddDocumentInput {
  kind: DocumentKind
  originalFilename: string
  mimeType: string
  data: Buffer
}

export async function addDocument(input: AddDocumentInput): Promise<DocumentSummary> {
  if (input.data.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error(`File exceeds the ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB size limit`)
  }
  if (input.data.byteLength === 0) {
    throw new Error('File is empty')
  }

  ensureProfileRow()

  // Fails closed: if a storage mode was somehow never chosen, default to the
  // more protective option rather than silently writing plaintext.
  const mode = getStorageMode() ?? 'encrypted'
  const extractedTextRaw = await extractText(input.mimeType, input.data)
  const id = randomUUID()

  // The actual file write + DB insert is what a storage-location migration's
  // snapshot must never race — see storageWriteLock.ts. Text extraction
  // above doesn't touch shared file state, so it stays outside the lock.
  return withStorageWriteLock(() => {
    const { data: storedBytes, isEncrypted } = writeSecureBuffer(input.data, mode)
    const storedPath = join(documentsDir(), id)
    writeFileSync(storedPath, storedBytes)

    const now = new Date().toISOString()
    getDb()
      .insert(documents)
      .values({
        id,
        profileId: PROFILE_ID,
        kind: input.kind,
        originalFilename: input.originalFilename,
        storedPath,
        mimeType: input.mimeType,
        sizeBytes: input.data.byteLength,
        extractedText: writeSecureField(extractedTextRaw, mode),
        isEncryptedAtRest: isEncrypted,
        createdAt: now
      })
      .run()

    const row = getDb().select().from(documents).where(eq(documents.id, id)).get()
    if (!row) throw new Error('Failed to read back inserted document')
    return toSummary(row)
  })
}

export function listDocuments(): DocumentSummary[] {
  return getDb().select().from(documents).where(eq(documents.profileId, PROFILE_ID)).all().map(toSummary)
}

export function getExtractedText(id: string): string | null {
  const row = getDb().select().from(documents).where(eq(documents.id, id)).get()
  if (!row) return null
  return readSecureField(row.extractedText)
}

export function deleteDocument(id: string): Promise<void> {
  return withStorageWriteLock(() => {
    const row = getDb().select().from(documents).where(eq(documents.id, id)).get()
    if (!row) return
    if (existsSync(row.storedPath)) {
      unlinkSync(row.storedPath)
    }
    getDb().delete(documents).where(eq(documents.id, id)).run()
  })
}

/** Decrypts (if needed) and returns the raw file bytes — used when a document must be handed to something outside the DB, e.g. a Playwright file upload. */
export function readDocumentBytes(id: string): Buffer | null {
  const row = getDb().select().from(documents).where(eq(documents.id, id)).get()
  if (!row || !existsSync(row.storedPath)) return null
  const raw = readFileSync(row.storedPath)
  return readSecureBuffer(raw, row.isEncryptedAtRest)
}

/**
 * Re-encrypts (or decrypts) one document's file and extracted text in place
 * for a storage-mode change. Reads using the document's own current format
 * (self-describing, not the global setting) so this is safe to call
 * regardless of what order documents are processed in.
 */
export function rewriteDocumentStorageMode(id: string, mode: StorageMode): Promise<void> {
  return withStorageWriteLock(() => {
    const row = getDb().select().from(documents).where(eq(documents.id, id)).get()
    if (!row || !existsSync(row.storedPath)) return

    const decryptedBytes = readSecureBuffer(readFileSync(row.storedPath), row.isEncryptedAtRest)
    const decryptedText = readSecureField(row.extractedText)

    const { data: newBytes, isEncrypted } = writeSecureBuffer(decryptedBytes, mode)
    writeFileSync(row.storedPath, newBytes)

    getDb()
      .update(documents)
      .set({ isEncryptedAtRest: isEncrypted, extractedText: writeSecureField(decryptedText, mode) })
      .where(eq(documents.id, id))
      .run()
  })
}
