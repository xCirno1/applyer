import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import { listCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { addBoard, removeBoard, setBoardEnabled } from '../companyBoardActions'
import { appLogger } from '../logger'
import type { ListCompanyBoardsQuery } from '@shared/types/companyBoard'

export function registerCompanyBoardsIpc(): void {
  ipcMain.handle(IPC.companyBoards.list, (_event, query: ListCompanyBoardsQuery) => {
    return listCompanyBoards(query ?? {})
  })

  ipcMain.handle(
    IPC.companyBoards.add,
    async (_event, payload: { query?: unknown; companyName?: unknown }) => {
      // IPC payloads are renderer-supplied and never trusted as-is.
      const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
      if (!query) return { ok: false, error: appError('boardInputRequired') }

      const companyName = typeof payload?.companyName === 'string' ? payload.companyName.trim() : undefined

      try {
        // No provider argument from the UI on purpose: a person pasting a
        // board URL has already said which provider it is, and a person
        // typing a company name doesn't know. Probing answers both.
        const outcome = await addBoard({ query, companyName, addedBy: 'user' })

        switch (outcome.status) {
          case 'added':
          case 'already_tracked':
            return {
              ok: true,
              status: outcome.status,
              board: outcome.board,
              jobCount: outcome.jobCount,
              verified: outcome.verified,
              ambiguous: outcome.ambiguous,
              candidates: outcome.candidates
            }
          case 'not_found':
            return { ok: false, error: appError('boardNotFound', { tried: outcome.triedTokens.join(', ') }) }
          case 'limit_reached':
            return { ok: false, error: appError('boardLimitReached', { limit: outcome.limit }) }
          case 'error':
            return { ok: false, error: appError('boardUnreachable', { message: outcome.message }) }
        }
      } catch (err) {
        appLogger.error(`companyBoards:add failed: ${String(err)}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )

  ipcMain.handle(IPC.companyBoards.remove, (_event, { id }: { id: unknown }) => {
    if (typeof id !== 'string' || !id) return { ok: false, error: appError('boardInputRequired') }
    return { ok: removeBoard(id) }
  })

  ipcMain.handle(IPC.companyBoards.setEnabled, (_event, { id, enabled }: { id: unknown; enabled: unknown }) => {
    if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') {
      return { ok: false, error: appError('boardInputRequired') }
    }
    const board = setBoardEnabled(id, enabled)
    return board ? { ok: true, board } : { ok: false, error: appError('boardNotFound', { tried: id }) }
  })
}
