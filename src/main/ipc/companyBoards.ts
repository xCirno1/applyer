import { ipcMain, dialog } from 'electron'
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { IPC } from '@shared/types/ipcEvents'
import type { DialogLabels } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import { countCompanyBoards, listCompanyBoardKeys, listCompanyBoards } from '../db/repositories/companyBoardsRepository'
import {
  addBoard,
  fetchBoardsNow,
  importCsvBoards,
  removeBoard,
  removeBoards,
  setBoardEnabled,
  setBoardsEnabled
} from '../companyBoardActions'
import { parseCsv } from '../dataTransfer/csvParse'
import {
  isMappingUsable,
  normaliseImportOptions,
  normaliseMapping,
  planCsvImport,
  suggestBoardCsvMapping,
  type PlannedCsvImport
} from '../dataTransfer/companyBoardCsv'
import { appLogger } from '../logger'
import {
  BOARD_CSV_PREVIEW_ROWS,
  MAX_BOARD_CSV_BYTES,
  MAX_BOARD_CSV_ROWS,
  MAX_COMPANY_BOARDS,
  MAX_MANUAL_BOARD_FETCH
} from '@shared/constants'
import type {
  BoardCsvCapacity,
  BoardCsvImportResult,
  BoardCsvPickResult,
  BoardCsvPlanResult,
  FetchCompanyBoardsResult,
  ListCompanyBoardsQuery
} from '@shared/types/companyBoard'

/**
 * The file picked for the current import, parsed once.
 *
 * Held here rather than re-read per request for two reasons: the mapping
 * dialog re-plans on every change a user makes, and this is also what keeps
 * the renderer from naming an arbitrary path — the only file this module ever
 * reads is one the user chose in the OS dialog a moment ago. One entry is
 * enough: a second pick replaces the first, and there is one import dialog.
 */
let pendingCsv: { filePath: string; headers: string[]; rows: string[][] } | null = null

/**
 * The id list behind a bulk action. IPC payloads are renderer-supplied, so
 * this is where a selection stops being arbitrary JSON: non-strings are
 * dropped and duplicates collapsed, which for the fetch handler is the
 * difference between a bounded batch and a repeated id fanned out into
 * repeated outbound requests.
 */
function readBoardIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function capacity(): BoardCsvCapacity {
  const tracked = countCompanyBoards()
  return { tracked, limit: MAX_COMPANY_BOARDS, remaining: Math.max(0, MAX_COMPANY_BOARDS - tracked) }
}

/**
 * Re-plans the pending file against a mapping the renderer supplies. Both the
 * preview and the write go through this, so what the dialog shows and what
 * the import does cannot drift apart.
 */
function planPending(
  filePath: unknown,
  mapping: unknown,
  options: unknown
): { ok: true; planned: PlannedCsvImport } | { ok: false; error: ReturnType<typeof appError> } {
  if (typeof filePath !== 'string' || !pendingCsv || pendingCsv.filePath !== filePath) {
    return { ok: false, error: appError('csvFileMissing') }
  }

  const normalisedMapping = normaliseMapping(mapping, pendingCsv.headers.length)
  if (!isMappingUsable(normalisedMapping)) return { ok: false, error: appError('csvNoBoardColumn') }

  const room = capacity()
  // Read once, not once per row: a file may carry tens of thousands of
  // candidates and this runs again on every mapping change, where a query per
  // candidate would hold the main process (and so every other IPC call) for
  // the length of the file. The watchlist is bounded, so this set is small.
  const trackedKeys = listCompanyBoardKeys()
  return {
    ok: true,
    planned: planCsvImport({
      rows: pendingCsv.rows,
      mapping: normalisedMapping,
      options: normaliseImportOptions(options, room.remaining),
      isTracked: (boardKey) => trackedKeys.has(boardKey),
      capacity: room
    })
  }
}

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

  ipcMain.handle(
    IPC.companyBoards.setEnabledMany,
    (_event, payload: { ids?: unknown; enabled?: unknown }) => {
      const ids = readBoardIds(payload?.ids)
      if (ids.length === 0 || typeof payload?.enabled !== 'boolean') {
        return { ok: false, error: appError('boardInputRequired') }
      }
      return { ok: true, updated: setBoardsEnabled(ids, payload.enabled) }
    }
  )

  ipcMain.handle(IPC.companyBoards.removeMany, (_event, payload: { ids?: unknown }) => {
    const ids = readBoardIds(payload?.ids)
    if (ids.length === 0) return { ok: false, error: appError('boardInputRequired') }
    return { ok: true, removed: removeBoards(ids) }
  })

  ipcMain.handle(
    IPC.companyBoards.fetch,
    async (_event, payload: { ids?: unknown }): Promise<FetchCompanyBoardsResult> => {
      const ids = readBoardIds(payload?.ids)

      if (ids.length === 0) return { ok: false, error: appError('boardInputRequired') }
      if (ids.length > MAX_MANUAL_BOARD_FETCH) {
        return { ok: false, error: appError('boardFetchLimit', { limit: MAX_MANUAL_BOARD_FETCH }) }
      }

      try {
        return { ok: true, results: await fetchBoardsNow(ids) }
      } catch (err) {
        appLogger.error(`companyBoards:fetch failed: ${String(err)}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.companyBoards.pickCsv,
    async (_event, { labels }: { labels: DialogLabels }): Promise<BoardCsvPickResult> => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: labels.title,
        properties: ['openFile'],
        filters: [{ name: labels.filterName, extensions: ['csv', 'tsv', 'txt'] }]
      })
      const filePath = filePaths[0]
      if (canceled || !filePath) return { ok: false, canceled: true }

      try {
        // Checked before reading, not after: the point is to not pull a
        // multi-gigabyte file into memory to discover it was the wrong one.
        const { size } = statSync(filePath)
        if (size > MAX_BOARD_CSV_BYTES) {
          return { ok: false, error: appError('csvTooLarge', { max: Math.floor(MAX_BOARD_CSV_BYTES / (1024 * 1024)) }) }
        }

        const parsed = parseCsv(readFileSync(filePath, 'utf-8'), MAX_BOARD_CSV_ROWS)
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          return { ok: false, error: appError('csvEmpty') }
        }

        // Replaced only now that the new file has parsed into something
        // usable. A rejected replacement leaves the dialog showing the file it
        // already had, so its Import button still means what it says instead
        // of failing with "that file is gone" over a file the user never
        // stopped choosing.
        pendingCsv = { filePath, headers: parsed.headers, rows: parsed.rows }

        return {
          ok: true,
          file: {
            filePath,
            fileName: basename(filePath),
            headers: parsed.headers,
            sampleRows: parsed.rows.slice(0, BOARD_CSV_PREVIEW_ROWS),
            rowCount: parsed.rows.length,
            truncated: parsed.truncated,
            suggestedMapping: suggestBoardCsvMapping(parsed.headers)
          },
          capacity: capacity()
        }
      } catch (err) {
        // Same reasoning as the empty-file branch above: an unreadable
        // replacement is a failed pick, not a reason to drop the file that
        // was already loaded and is still on screen.
        appLogger.error(`companyBoards:pickCsv failed: ${String(err)}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.companyBoards.planCsv,
    (_event, payload: { filePath?: unknown; mapping?: unknown; options?: unknown }): BoardCsvPlanResult => {
      try {
        const result = planPending(payload?.filePath, payload?.mapping, payload?.options)
        if (!result.ok) return { ok: false, error: result.error }
        return { ok: true, plan: result.planned.plan }
      } catch (err) {
        appLogger.error(`companyBoards:planCsv failed: ${String(err)}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )

  // Closing the dialog without importing drops the parsed file rather than
  // holding it for the rest of the session; a re-opened dialog picks again.
  ipcMain.on(IPC.companyBoards.releaseCsv, () => {
    pendingCsv = null
  })

  ipcMain.handle(
    IPC.companyBoards.importCsv,
    (_event, payload: { filePath?: unknown; mapping?: unknown; options?: unknown }): BoardCsvImportResult => {
      try {
        // Re-planned rather than trusting a plan the renderer round-tripped:
        // the watchlist can have changed since the preview was computed (the
        // agent adds boards while this dialog is open), and the ceiling has
        // to be applied against the table as it is at the moment of writing.
        const result = planPending(payload?.filePath, payload?.mapping, payload?.options)
        if (!result.ok) return { ok: false, error: result.error }

        const { plan, boards } = result.planned
        const summary = importCsvBoards(boards, {
          totalRows: plan.totalRows,
          alreadyTracked: plan.alreadyTracked,
          skippedRows: plan.unusable + plan.belowThreshold + plan.duplicates + plan.overLimit
        })
        pendingCsv = null
        return { ok: true, summary }
      } catch (err) {
        appLogger.error(`companyBoards:importCsv failed: ${String(err)}`)
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )
}
