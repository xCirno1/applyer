import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { listCompanyBoards } from '../../db/repositories/companyBoardsRepository'
import { jsonResult, textError } from '../toolResult'
import type { listCompanyBoardsShape } from '../schemas'

type Args = { [K in keyof typeof listCompanyBoardsShape]: z.infer<(typeof listCompanyBoardsShape)[K]> }

export function listCompanyBoardsTool(args: Args): CallToolResult {
  try {
    const { boards, total } = listCompanyBoards({
      search: args.search,
      limit: args.limit,
      offset: args.offset
    })

    return jsonResult({
      total,
      boards: boards.map((board) => ({
        company: board.companyName,
        provider: board.provider,
        token: board.token,
        // Provider plus token is not an identity: one Workday tenant serves
        // several career sites, and the same Lever slug exists in both
        // regions. Without these two, such boards are indistinguishable here,
        // so the agent cannot tell the caller which one it is looking at (and
        // `boardKey` is the single value the rest of the app files them
        // under). Null for the providers that need neither.
        host: board.host,
        site: board.site,
        boardKey: board.boardKey,
        enabled: board.enabled,
        addedBy: board.addedBy,
        lastCheckedAt: board.lastCheckedAt,
        // 0 is a live board with nothing open. null is "nothing has counted
        // this board", which `lastCheckedAt` tells apart: never fetched, or
        // only ever reached by a keyword search on a provider that filters
        // server-side and so never answered how big the board is.
        lastJobCount: board.lastJobCount,
        lastError: board.lastError
      })),
      message:
        total === 0
          ? 'No company boards are tracked yet, so searching greenhouse/lever/ashby/workday returns nothing. Use add_company_board first.'
          : 'These boards are fetched and filtered locally on every search that includes their provider.'
    })
  } catch (err) {
    return textError(`Failed to list company boards: ${String(err)}`)
  }
}
