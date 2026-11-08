import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { countSubmittedByStage, listStages } from '../../db/repositories/applicationStagesRepository'
import { jsonResult, textError } from '../toolResult'

/**
 * The post-submission stages in the user's order, each with how many
 * Submitted jobs sit in it, plus the count with no stage yet. Names are what
 * `set_application_stage` and `list_jobs` take; the agent never creates or
 * renames a stage, so a stage it needs that is missing is something to tell
 * the user about rather than work around.
 */
export async function listApplicationStagesTool(): Promise<CallToolResult> {
  try {
    const stages = listStages()
    const counts = new Map(countSubmittedByStage().map((entry) => [entry.stageId, entry.count]))
    return jsonResult({
      stages: stages.map((stage) => ({
        name: stage.label,
        id: stage.id,
        builtin: stage.isBuiltin,
        submittedJobs: counts.get(stage.id) ?? 0
      })),
      submittedWithoutStage: counts.get(null) ?? 0,
      note: 'Only Submitted jobs carry a stage. The user adds, renames, reorders and deletes stages in Applyer (Manage stages, beside the board filters).'
    })
  } catch (err) {
    return textError(`Failed to list application stages: ${String(err)}`)
  }
}
