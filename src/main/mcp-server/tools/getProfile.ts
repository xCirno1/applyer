import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { getProfile } from '../../db/repositories/profileRepository'
import { listDocuments } from '../../db/repositories/documentsRepository'
import { isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { jsonResult, textError } from '../toolResult'

export async function getProfileTool(): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError(
      'No profile found — open Applyer and complete onboarding (profile + documents) before searching or matching jobs.'
    )
  }

  const profile = getProfile()
  const documents = listDocuments()

  return jsonResult({
    profile,
    documents: documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      filename: d.originalFilename,
      hasExtractedText: d.hasExtractedText
    }))
  })
}
