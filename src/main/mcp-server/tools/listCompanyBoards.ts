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
        enabled: board.enabled,
        addedBy: board.addedBy,
        lastCheckedAt: board.lastCheckedAt,
        // 0 is a live board with nothing open; null is "never fetched yet".
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
