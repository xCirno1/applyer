import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import { getProfile, saveProfile } from '../db/repositories/profileRepository'
import { listDocuments, addDocument, deleteDocument } from '../db/repositories/documentsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { MAX_DOCUMENT_SIZE_BYTES } from '@shared/constants'
import type { UploadDocumentRequest } from '@shared/types/ipcEvents'

const profileFieldsSchema = z.object({
  fullName: z.string().max(200),
  email: z.union([z.literal(''), z.string().email()]),
  phone: z.string().max(50),
  location: z.string().max(200),
  linkedinUrl: z.string().max(500),
  githubUrl: z.string().max(500),
  portfolioUrl: z.string().max(500),
  workAuthorization: z.string().max(200),
  desiredRoles: z.array(z.string().max(100)).max(20),
  desiredLocations: z.array(z.string().max(200)).max(20),
  remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'no_preference']),
  salaryMin: z.number().int().min(0).max(10_000_000).nullable(),
  salaryMax: z.number().int().min(0).max(10_000_000).nullable(),
  salaryCurrency: z.string().max(10),
  yearsExperience: z.number().int().min(0).max(80).nullable(),
  summary: z.string().max(5000),
  skills: z.array(z.string().max(100)).max(100)
})

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
])

const uploadDocumentSchema = z.object({
  kind: z.enum(['resume', 'cover_letter', 'other']),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  data: z.instanceof(ArrayBuffer)
})

export function registerProfileIpc(): void {
  ipcMain.handle(IPC.profile.get, () => {
    return { profile: getProfile(), documents: listDocuments() }
  })

  ipcMain.handle(IPC.profile.save, (_event, fields: unknown) => {
    const parsed = profileFieldsSchema.safeParse(fields)
    if (!parsed.success) {
      logActivity('warn', 'Rejected invalid profile save from renderer', { error: parsed.error.message })
      return { ok: false, error: appError('invalidProfileData') }
    }
    saveProfile(parsed.data)
    return { ok: true }
  })

  ipcMain.handle(IPC.profile.uploadDocument, async (_event, request: unknown) => {
    const parsed = uploadDocumentSchema.safeParse(request)
    if (!parsed.success) {
      return { ok: false, error: appError('invalidUploadRequest') }
    }
    const req = parsed.data as UploadDocumentRequest

    if (!ALLOWED_MIME_TYPES.has(req.mimeType)) {
      return { ok: false, error: appError('unsupportedFileType', { mimeType: req.mimeType }) }
    }
    if (req.data.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
      return { ok: false, error: appError('fileTooLarge', { limit: MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024) }) }
    }

    try {
      const summary = await addDocument({
        kind: req.kind,
        originalFilename: req.filename,
        mimeType: req.mimeType,
        data: Buffer.from(req.data)
      })
      return { ok: true, document: summary }
    } catch (err) {
      logActivity('error', 'Document upload failed', { error: String(err) })
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.profile.deleteDocument, async (_event, { documentId }: { documentId: string }) => {
    await deleteDocument(documentId)
    return { ok: true }
  })
}
