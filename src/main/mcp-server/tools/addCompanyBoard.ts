import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { addBoard } from '../../companyBoardActions'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { jsonResult, textError } from '../toolResult'
import type { addCompanyBoardShape } from '../schemas'

type Args = { [K in keyof typeof addCompanyBoardShape]: z.infer<(typeof addCompanyBoardShape)[K]> }

export async function addCompanyBoardTool(args: Args): Promise<CallToolResult> {
  if (args.token && !args.provider) {
    return textError(
      'token needs the provider it belongs to — a slug on its own does not say which API to ask. Pass both, or pass just `company` (a name, domain, or board URL) and let Applyer work the board out.'
    )
  }

  try {
    const outcome = await addBoard({
      query: args.company,
      provider: args.provider,
      token: args.token,
      companyName: args.displayName,
      addedBy: 'agent'
    })

    switch (outcome.status) {
      case 'added':
      case 'already_tracked': {
        const { board } = outcome
        return jsonResult({
          status: outcome.status,
          board: {
            id: board.id,
            company: board.companyName,
            provider: board.provider,
            token: board.token,
            enabled: board.enabled
          },
          openRoles: outcome.jobCount,
          // Each of these is a state the agent should report rather than
          // paper over: a board that holds nothing today, one that couldn't
          // be reached, and a company that answers on two systems at once.
          message: [
            outcome.status === 'already_tracked'
              ? 'This board was already being tracked.'
              : `Now tracking ${board.companyName}'s ${board.provider} board — search_jobs will include it.`,
            outcome.verified
              ? outcome.jobCount === 0
                ? 'The board answered but has no open roles right now (that is a real answer, not a wrong slug).'
                : `It currently lists ${outcome.jobCount} open role(s).`
              : 'The board could not be reached to confirm it just now; it has been tracked anyway and the next search will find out.',
            outcome.ambiguous
              ? `This company answered on more than one ATS (${outcome.candidates
                  .filter((c) => c.jobCount > 0)
                  .map((c) => `${c.provider}: ${c.jobCount}`)
                  .join(', ')}) — the one with the most roles was kept, which is usually the current one after a migration.`
              : null
          ]
            .filter(Boolean)
            .join(' ')
        })
      }

      case 'not_found':
        return jsonResult({
          status: 'not_found',
          triedSlugs: outcome.triedTokens,
          message:
            'No Greenhouse, Lever or Ashby board answered for those slugs (every one returned 404, which is the only response that proves a slug is wrong). If you can find the real board URL, pass it as `company`; Workday boards can only be added by URL.'
        })

      case 'limit_reached':
        return textError(
          `Cannot track more than ${outcome.limit} company boards — each one is fetched on every search. Ask the user to remove some in Indexed Jobs > Company Boards.`
        )

      case 'error':
        return textError(`Could not add that board: ${outcome.message}`)
    }
  } catch (err) {
    logActivity('error', 'add_company_board failed', { error: String(err) })
    return textError(`Failed to add company board: ${String(err)}`)
  }
}
