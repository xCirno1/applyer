import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getProfile } from '../../db/repositories/profileRepository'
import { getExtractedText, listDocuments } from '../../db/repositories/documentsRepository'
import { isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { jsonResult, textError } from '../toolResult'
import type { getProfileShape } from '../schemas'

type Args = { [K in keyof typeof getProfileShape]: z.infer<(typeof getProfileShape)[K]> }

/**
 * A resume runs a few thousand characters; anything past this is a document
 * that was never a resume, and shipping all of it would cost more context
 * than the rest of the conversation. Truncation is reported per document so
 * the agent knows it is looking at part of a file rather than all of it.
 */
const MAX_DOCUMENT_TEXT_CHARS = 20_000

export async function getProfileTool(args?: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError(
      'No profile found — open Applyer and complete onboarding (profile + documents) before searching or matching jobs.'
    )
  }

  const profile = getProfile()
  const documents = listDocuments()

  return jsonResult({
    profile,
    documents: documents.map((d) => {
      const summary = {
        id: d.id,
        kind: d.kind,
        filename: d.originalFilename,
        hasExtractedText: d.hasExtractedText
      }
      if (!args?.includeDocumentText || !d.hasExtractedText) return summary

      // Read per document rather than in the list query: the text is the
      // largest column in the table and is decrypted on read, so it is only
      // paid for when it was actually asked for.
      const text = getExtractedText(d.id)
      if (text === null) return summary

      return {
        ...summary,
        text: text.slice(0, MAX_DOCUMENT_TEXT_CHARS),
        textTruncated: text.length > MAX_DOCUMENT_TEXT_CHARS
      }
    })
  })
}
