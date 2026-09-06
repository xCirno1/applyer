import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Tooltip from '../ui/Tooltip'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'

/**
 * Appears above the watchlist while rows are selected — the bulk counterpart
 * of the per-row Fetch/Pause/Remove buttons, in the same order, so the two
 * read as one set of actions at two scales.
 *
 * Each action is scoped to the selected boards it actually applies to, the
 * same rule the job board's `BulkActionBar` follows: Pause only counts the
 * running boards and Resume only the paused ones, so a mixed selection does
 * the sensible half of each rather than toggling everything into one state.
 * Fetch applies to all of them, paused included — checking a board before
 * turning it back on is exactly when that is wanted.
 *
 * Only Remove confirms. Pausing and fetching are reversible; removing a run
 * of boards is not, and it is the one action here that can undo a long
 * afternoon of curating a watchlist.
 *
 * Each action is one IPC call (`setEnabledMany`/`removeMany`/`fetch`) rather
 * than a loop of single-row calls, so a selection of fifty boards is one
 * write and one list refresh instead of fifty. Fetch is the exception to
 * "one refresh": the boards are fetched several at a time and each result is
 * pushed back as it lands (`companyBoards:fetched`, carrying the stored row),
 * so a row stops spinning and shows its new count the moment that board
 * answers instead of the whole selection waiting on the slowest member — the
 * panel replaces that one row rather than re-reading the list, and the
 * summary toast (which is a summary) still waits for the whole batch.
 *
 * Both the selection and a Shift range span the whole filtered list rather
 * than the current page: paging is a window onto one list, so anchoring on
 * page 1 and Shift-clicking on page 2 selects everything between (scoping
 * the range to the page instead would throw the anchor away whenever the
 * page changed, which is not something the person did). A filter change
 * still drops the rows it hides.
 */

interface Props {
  /** The selected boards that are on screen — see `visibleSelection`. */
  boards: CompanyBoardRecord[]
  onClear: () => void
  onFetch: (ids: string[]) => Promise<void>
  onSetEnabled: (ids: string[], enabled: boolean) => Promise<void>
  onRemove: (ids: string[]) => Promise<void>
}

export default function BoardBulkActionBar({
  boards,
  onClear,
  onFetch,
  onSetEnabled,
  onRemove
}: Props): ReactElement | null {
  const { t } = useTranslation('indexedJobs')
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (boards.length === 0) return null

  const ids = boards.map((board) => board.id)
  const pausableIds = boards.filter((board) => board.enabled).map((board) => board.id)
  const resumableIds = boards.filter((board) => !board.enabled).map((board) => board.id)
  const busy = fetching || pausing || resuming || removing

  const run = async (
    setBusy: (value: boolean) => void,
    action: () => Promise<void>,
    clearAfter = false
  ): Promise<void> => {
    setBusy(true)
    try {
      await action()
      if (clearAfter) onClear()
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (): Promise<void> => {
    setConfirmRemoveOpen(false)
    // The selected rows are gone afterwards, so the selection goes with them.
    await run(setRemoving, () => onRemove(ids), true)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border border-border bg-canvas-soft px-3 py-1.5">
      {/* The count carries the modifier keys: someone who has selected one
          row is exactly the person about to want a second. */}
      <Tooltip label={t('boards.selection.hint')}>
        <span className="cursor-help text-[12px] font-medium text-text underline decoration-dotted underline-offset-2">
          {t('boards.selection.count', { count: boards.length })}
        </span>
      </Tooltip>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
        {t('boards.selection.clear')}
      </Button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" loading={fetching} disabled={busy} onClick={() => run(setFetching, () => onFetch(ids))}>
          {t('boards.selection.fetch', { count: ids.length })}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={pausing}
          disabled={busy || pausableIds.length === 0}
          onClick={() => run(setPausing, () => onSetEnabled(pausableIds, false))}
        >
          {t('boards.selection.pause', { count: pausableIds.length })}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={resuming}
          disabled={busy || resumableIds.length === 0}
          onClick={() => run(setResuming, () => onSetEnabled(resumableIds, true))}
        >
          {t('boards.selection.resume', { count: resumableIds.length })}
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={removing}
          disabled={busy}
          onClick={() => setConfirmRemoveOpen(true)}
        >
          {t('boards.selection.remove', { count: ids.length })}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRemoveOpen}
        title={t('boards.selection.removeTitle', { count: ids.length })}
        message={t('boards.selection.removeMessage', { count: ids.length })}
        confirmLabel={t('boards.remove')}
        danger
        loading={removing}
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemoveOpen(false)}
      />
    </div>
  )
}
