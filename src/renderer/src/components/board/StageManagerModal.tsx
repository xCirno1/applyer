import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Skeleton from '../ui/Skeleton'
import Tag from '../ui/Tag'
import Tooltip from '../ui/Tooltip'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useStagesStore } from '../../state/stagesStore'
import { customStageCount, stageCountRows } from '../../state/stagesStoreLogic'
import {
  MAX_CUSTOM_STAGES,
  STAGE_LABEL_MAX_LENGTH,
  checkStageLabel,
  isStageLabelTaken,
  moveStage,
  type ApplicationStage
} from '@shared/types/applicationStage'
import { useStageLabel } from './useStageLabel'

/*
 * Settings for the Submitted column's stages, opened from the board's
 * filter strip. A modal rather than a collapsible under the board: each row
 * carries a count and up to four actions, and the list can grow to thirty
 * custom stages.
 *
 * One dense row per stage, in the order the board and the overview use:
 * the name (an inline field while renaming), a "Built-in" tag for the five
 * that ship with the app, how many Submitted jobs are in it, the up/down
 * arrows, then Rename and Delete for custom stages only. Every delete is
 * confirmed with `ConfirmDialog`, and the message says how many jobs move
 * back to no stage, since that is what deleting a stage in use does.
 *
 * Names are checked here with the same `checkStageLabel`/`isStageLabelTaken`
 * the main process applies, so most mistakes are caught before a request;
 * the main process still has the final word and its refusal is toasted.
 */

interface StageManagerModalProps {
  open: boolean
  onClose: () => void
}

type NameProblem = 'empty' | 'tooLong' | 'taken' | null

function nameProblem(stages: readonly ApplicationStage[], raw: string, exceptId?: string): NameProblem {
  const check = checkStageLabel(raw)
  if (!check.ok) return check.problem
  return isStageLabelTaken(stages, check.label, exceptId) ? 'taken' : null
}

/** Mounts the body only while open, so a reopened manager starts with empty fields. */
export default function StageManagerModal(props: StageManagerModalProps): ReactElement | null {
  return props.open ? <StageManagerBody {...props} /> : null
}

function StageManagerBody({ open, onClose }: StageManagerModalProps): ReactElement {
  const { t } = useTranslation('board')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const stageLabel = useStageLabel()
  const stages = useStagesStore((s) => s.stages)
  const counts = useStagesStore((s) => s.counts)
  const loading = useStagesStore((s) => s.loading)
  const loadedOnce = useStagesStore((s) => s.loadedOnce)
  const fetchStages = useStagesStore((s) => s.fetch)
  const createStage = useStagesStore((s) => s.create)
  const renameStage = useStagesStore((s) => s.rename)
  const reorderStages = useStagesStore((s) => s.reorder)
  const removeStage = useStagesStore((s) => s.remove)

  const [newName, setNewName] = useState('')
  const [newNameTouched, setNewNameTouched] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [savingRename, setSavingRename] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ stage: ApplicationStage; count: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fresh counts each time the manager opens, so "N jobs" (what a delete
  // would clear) is never a stale figure.
  useEffect(() => {
    void fetchStages()
  }, [fetchStages])

  const countById = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of stageCountRows(stages, counts).rows) if (row.stage) map.set(row.stage.id, row.count)
    return map
  }, [stages, counts])

  const customCount = customStageCount(stages)
  const atLimit = customCount >= MAX_CUSTOM_STAGES
  const newProblem = nameProblem(stages, newName)
  const editProblem = editingId ? nameProblem(stages, editDraft, editingId) : null

  const problemText = (problem: NameProblem): string | null => {
    if (problem === 'empty') return t('stages.manager.nameEmpty')
    if (problem === 'tooLong') return t('stages.manager.nameTooLong', { max: STAGE_LABEL_MAX_LENGTH })
    if (problem === 'taken') return t('stages.manager.nameTaken')
    return null
  }

  const handleAdd = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setNewNameTouched(true)
    if (newProblem || adding || atLimit) return
    setAdding(true)
    const result = await createStage(newName)
    setAdding(false)
    if (!result.ok) {
      toast.error(errorMessage(result.error))
      return
    }
    toast.success(t('stages.toast.created', { name: result.value.label }))
    setNewName('')
    setNewNameTouched(false)
  }

  const startRename = (stage: ApplicationStage): void => {
    setEditingId(stage.id)
    setEditDraft(stage.label)
  }

  const saveRename = async (): Promise<void> => {
    if (!editingId || editProblem || savingRename) return
    const current = stages.find((stage) => stage.id === editingId)
    const check = checkStageLabel(editDraft)
    if (current && check.ok && current.label === check.label) {
      setEditingId(null)
      return
    }
    setSavingRename(true)
    const result = await renameStage(editingId, editDraft)
    setSavingRename(false)
    if (!result.ok) {
      toast.error(errorMessage(result.error))
      return
    }
    toast.success(t('stages.toast.renamed', { name: result.value.label }))
    setEditingId(null)
  }

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveRename()
    } else if (e.key === 'Escape') {
      // Cancels the rename only; without this the modal's own Escape
      // handler would close the whole manager.
      e.preventDefault()
      e.stopPropagation()
      setEditingId(null)
    }
  }

  const handleMove = async (stageId: string, delta: -1 | 1): Promise<void> => {
    if (reordering) return
    const order = moveStage(stages, stageId, delta)
    if (order.every((id, index) => stages[index]?.id === id)) return
    setReordering(true)
    const result = await reorderStages(order)
    setReordering(false)
    if (!result.ok) toast.error(t('stages.toast.reorderFailed'))
  }

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    const { stage } = confirmDelete
    setDeleting(true)
    const result = await removeStage(stage.id)
    setDeleting(false)
    setConfirmDelete(null)
    if (!result.ok) {
      toast.error(errorMessage(result.error))
      return
    }
    const cleared = typeof result.value?.clearedJobs === 'number' ? result.value.clearedJobs : 0
    toast.success(
      cleared > 0
        ? t('stages.toast.deletedCleared', { name: stage.label, count: cleared })
        : t('stages.toast.deleted', { name: stage.label })
    )
  }

  const busy = adding || savingRename || deleting

  return (
    <Modal open={open} onClose={onClose} title={t('stages.manager.title')} width="max-w-lg">
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-text-muted">{t('stages.manager.intro')}</p>

        {!loadedOnce && loading ? (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : stages.length === 0 ? (
          <p className="text-[12px] text-text-faint">{t('stages.manager.loadFailed')}</p>
        ) : (
          <ul className="flex flex-col border-y border-border-soft">
            {stages.map((stage, index) => {
              const name = stageLabel(stage)
              const jobs = countById.get(stage.id) ?? 0
              const editing = editingId === stage.id
              return (
                <li key={stage.id} className="flex min-h-7 items-center gap-2 border-b border-border-soft py-1 last:border-b-0">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {editing ? (
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <input
                          autoFocus
                          value={editDraft}
                          maxLength={STAGE_LABEL_MAX_LENGTH * 2}
                          aria-label={t('stages.manager.renameLabel', { name })}
                          aria-invalid={editProblem !== null}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={handleRenameKey}
                          disabled={savingRename}
                          className={`h-6 w-full min-w-0 border bg-canvas-soft px-2 text-[12px] text-text outline-none focus:border-accent ${
                            editProblem ? 'border-danger' : 'border-border'
                          }`}
                        />
                        {editProblem && <span className="text-[11px] text-danger">{problemText(editProblem)}</span>}
                      </div>
                    ) : (
                      <span className="min-w-0 truncate text-[12px] text-text">{name}</span>
                    )}
                    {stage.isBuiltin && !editing && (
                      <Tooltip label={t('stages.manager.builtinTooltip')}>
                        <Tag label={t('stages.manager.builtin')} />
                      </Tooltip>
                    )}
                  </div>

                  {!editing && (
                    <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
                      {t('stages.manager.jobs', { count: jobs })}
                    </span>
                  )}

                  <div className="flex shrink-0 items-center">
                    <ArrowButton
                      direction="up"
                      label={t('stages.manager.moveUp', { name })}
                      disabled={index === 0 || reordering || editing}
                      onClick={() => void handleMove(stage.id, -1)}
                    />
                    <ArrowButton
                      direction="down"
                      label={t('stages.manager.moveDown', { name })}
                      disabled={index === stages.length - 1 || reordering || editing}
                      onClick={() => void handleMove(stage.id, 1)}
                    />
                  </div>

                  {!stage.isBuiltin && (
                    <div className="flex shrink-0 items-center gap-1">
                      {editing ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={savingRename}>
                            {t('stages.manager.cancel')}
                          </Button>
                          <Button size="sm" onClick={() => void saveRename()} loading={savingRename} disabled={editProblem !== null}>
                            {t('stages.manager.save')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startRename(stage)} disabled={busy || editingId !== null}>
                            {t('stages.manager.rename')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete({ stage, count: jobs })}
                            disabled={busy || editingId !== null}
                          >
                            {t('stages.manager.delete')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-1">
          <label htmlFor="stage-manager-new" className="text-[12px] font-medium text-text-muted">
            {t('stages.manager.addLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="stage-manager-new"
              value={newName}
              maxLength={STAGE_LABEL_MAX_LENGTH * 2}
              placeholder={t('stages.manager.addPlaceholder')}
              aria-invalid={newNameTouched && newProblem !== null}
              onChange={(e) => {
                setNewName(e.target.value)
                if (e.target.value.trim()) setNewNameTouched(true)
              }}
              disabled={adding || atLimit || !loadedOnce}
              className={`h-7 min-w-0 flex-1 border bg-canvas-soft px-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent disabled:opacity-60 ${
                newNameTouched && newProblem ? 'border-danger' : 'border-border'
              }`}
            />
            <Button type="submit" size="md" loading={adding} disabled={atLimit || !loadedOnce || (newNameTouched && newProblem !== null)}>
              {t('stages.manager.add')}
            </Button>
          </div>
          {newNameTouched && newProblem ? (
            <span className="text-[11px] text-danger">{problemText(newProblem)}</span>
          ) : atLimit ? (
            <span className="text-[11px] text-warning">{t('stages.manager.limitReached', { max: MAX_CUSTOM_STAGES })}</span>
          ) : (
            <span className="text-[11px] text-text-faint">
              {t('stages.manager.limit', { count: customCount, max: MAX_CUSTOM_STAGES })}
            </span>
          )}
        </form>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('stages.confirmDelete.title', { name: confirmDelete?.stage.label ?? '' })}
        message={
          confirmDelete && confirmDelete.count > 0
            ? t('stages.confirmDelete.message', { count: confirmDelete.count })
            : t('stages.confirmDelete.messageUnused')
        }
        confirmLabel={t('stages.confirmDelete.confirm')}
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </Modal>
  )
}

function ArrowButton({
  direction,
  label,
  disabled,
  onClick
}: {
  direction: 'up' | 'down'
  label: string
  disabled: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d={direction === 'up' ? 'M3 7.5L6 4.5L9 7.5' : 'M3 4.5L6 7.5L9 4.5'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
