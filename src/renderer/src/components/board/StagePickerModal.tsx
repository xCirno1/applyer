import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../ui/Modal'
import Skeleton from '../ui/Skeleton'
import Spinner from '../ui/Spinner'
import { useStagesStore } from '../../state/stagesStore'
import { useJobActions } from './useJobActions'
import { useStageLabel } from './useStageLabel'

/*
 * "Set stage" for one or many Submitted jobs, opened from a card's
 * right-click menu and from `BulkActionBar`. The menu system has no
 * submenus, and a stage list can be thirty-odd entries long, so the choice
 * is a short modal list rather than a menu: one row per stage in the user's
 * order, then "No stage". Clicking a row applies it at once (that row shows
 * the spinner, the rest are disabled until it settles) and the modal closes
 * on success; a failure keeps it open with the toast explaining why.
 *
 * `jobIds` is only the Submitted part of whatever was selected; `skipped`
 * is how many of the selection were left out, said up front so nothing is
 * silently dropped.
 */

const NONE_ROW = '__none__'

interface StagePickerModalProps {
  open: boolean
  jobIds: string[]
  skipped: number
  /** The stage every target job is already in, if they all share one, marked "Current". */
  currentStageId: string | null | undefined
  onClose: () => void
  onApplied?: () => void
}

/** Mounts the body only while open, so a reopened picker starts with nothing pending. */
export default function StagePickerModal(props: StagePickerModalProps): ReactElement | null {
  return props.open ? <StagePickerBody {...props} /> : null
}

function StagePickerBody({
  open,
  jobIds,
  skipped,
  currentStageId,
  onClose,
  onApplied
}: StagePickerModalProps): ReactElement {
  const { t } = useTranslation('board')
  const stageLabel = useStageLabel()
  const stages = useStagesStore((s) => s.stages)
  const loadedOnce = useStagesStore((s) => s.loadedOnce)
  const fetchStages = useStagesStore((s) => s.fetch)
  const { setStageMany } = useJobActions()
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!loadedOnce) void fetchStages()
  }, [loadedOnce, fetchStages])

  const count = jobIds.length

  const choose = async (rowId: string): Promise<void> => {
    if (pending) return
    const stageId = rowId === NONE_ROW ? null : rowId
    const stage = stageId ? (stages.find((item) => item.id === stageId) ?? null) : null
    setPending(rowId)
    const ok = await setStageMany(jobIds, stageId, stageLabel(stage))
    setPending(null)
    if (ok) {
      onApplied?.()
      onClose()
    }
  }

  const rows = [
    ...stages.map((stage) => ({ id: stage.id, label: stageLabel(stage), current: currentStageId === stage.id })),
    { id: NONE_ROW, label: t('stages.none'), current: currentStageId === null }
  ]

  return (
    <Modal open={open} onClose={pending ? () => {} : onClose} title={t('stages.picker.title', { count })} width="max-w-sm">
      {/* Opened from a card's right-click menu, this renders inside that
          card in the React tree, so Enter/Space on a row would otherwise
          also reach the card's own handler and open the job. Escape is left
          to bubble: it is how the modal closes. */}
      <div
        className="flex flex-col gap-2"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
        }}
      >
        <p className="text-[12px] text-text-muted">{t('stages.picker.intro', { count })}</p>
        {skipped > 0 && <p className="text-[12px] text-warning">{t('stages.picker.skipped', { count: skipped })}</p>}
        {!loadedOnce ? (
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : (
          <div role="listbox" aria-label={t('detail.stageSelect')} className="flex max-h-72 flex-col overflow-y-auto border-y border-border-soft">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={row.current}
                disabled={pending !== null || count === 0}
                onClick={() => void choose(row.id)}
                className={`flex h-7 shrink-0 cursor-pointer items-center gap-2 border-b border-border-soft px-2 text-left text-[12px] last:border-b-0 hover:bg-canvas-soft disabled:cursor-not-allowed disabled:opacity-60 ${
                  row.id === NONE_ROW ? 'text-text-muted' : 'text-text'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.current && <span className="shrink-0 text-[11px] text-text-faint">{t('stages.picker.current')}</span>}
                {pending === row.id && <Spinner />}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
