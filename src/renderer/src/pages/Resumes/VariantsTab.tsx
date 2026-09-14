import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RESUME_TEMPLATE_IDS,
  RESUME_VARIANT_NAME_MAX_CHARS,
  resumeVariantNameKey,
  type ResumeContent,
  type ResumeTemplateId
} from '@shared/types/resume'
import { validateResumeContent } from '@shared/resume/resumeContentSchema'
import { diffResumeContent } from '@shared/resume/resumeDiff'
import { useResumesStore } from '../../state/resumesStore'
import { useJobsStore } from '../../state/jobsStore'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import MetaList from '../../components/ui/MetaList'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import TextField from '../../components/ui/TextField'
import ResumeStatusTag from '../../components/resume/ResumeStatusTag'
import ResumeWorkArea, { type ResumeWorkMode } from '../../components/resume/ResumeWorkArea'
import TailorPromptBlock from '../../components/resume/TailorPromptBlock'
import ResizeHandle from '../../components/ui/ResizeHandle'
import { DETAILS_MAX_PX, DETAILS_MIN_PX, LIST_MAX_PX, LIST_MIN_PX } from './resumesLayout'
import type { ResumesLayoutController } from './useResumesLayout'
import VariantList, { NEW_VARIANT_ROW_ID } from '../../components/resume/VariantList'
import { useResumeDraft } from './useResumeDraft'
import { useUnsavedSource } from '../../state/unsavedChangesStore'
import { isSameContent } from '../../components/resume/resumeEditorLogic'
import { readVariantTipDismissed, writeVariantTipDismissed } from './variantTip'

/*
 * Variants tab: list | work area | details. The selected variant comes from
 * the store (`selectedVariantId`) rather than local state because the job
 * detail modal's "Open in Resume Variants" sets it from another screen.
 * Variant content is loaded on selection and cached by the store; the
 * details panel is where every action lives (name, template, the jobs
 * using it, export, delete, the prompt for the agent), so the work area
 * stays the same component the Master tab uses.
 *
 * "New variant" is a local draft: a copy of the master with no name yet,
 * shown as a row at the top of the list and opened in Edit mode. Nothing is
 * written until Save, so closing it costs nothing; the store never sees an
 * unnamed variant, and neither does the agent.
 */

interface NewVariantDraft {
  name: string
  content: ResumeContent
  templateId: ResumeTemplateId
}

export default function VariantsTab({
  onGoToMaster,
  columns
}: {
  onGoToMaster: () => void
  columns: ResumesLayoutController
}): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null)
  // Re-clamp the side columns whenever the row's width changes (the window
  // shrank, or the tab just became visible with widths stored from a wider
  // window) so the preview keeps its minimum width; a hidden tab measures 0
  // and is left alone.
  const { setListWidth, setDetailsWidth } = columns
  const { listWidth, detailsWidth } = columns.layout
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const reclamp = (): void => {
      const available = row.clientWidth
      if (available <= 0) return
      setListWidth(listWidth, available, detailsWidth)
      setDetailsWidth(detailsWidth, available, listWidth)
    }
    reclamp()
    const observer = new ResizeObserver(reclamp)
    observer.observe(row)
    return () => observer.disconnect()
  }, [setListWidth, setDetailsWidth, listWidth, detailsWidth])
  const { t } = useTranslation('resumes')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const format = useFormatters()
  const master = useResumesStore((s) => s.master)
  const variants = useResumesStore((s) => s.variants)
  const loadedOnce = useResumesStore((s) => s.loadedOnce)
  const selectedVariantId = useResumesStore((s) => s.selectedVariantId)
  const select = useResumesStore((s) => s.select)
  const loadVariant = useResumesStore((s) => s.loadVariant)
  const variantsById = useResumesStore((s) => s.variantsById)
  const saveVariant = useResumesStore((s) => s.saveVariant)
  const deleteVariant = useResumesStore((s) => s.deleteVariant)
  const exportPdf = useResumesStore((s) => s.exportPdf)
  const openJob = useJobsStore((s) => s.openJob)

  // Mode and validation message are remembered per variant, so switching
  // rows starts each variant in Preview without an effect resetting state.
  const [viewState, setViewState] = useState<{
    variantId: string | null
    mode: ResumeWorkMode
    validationError: string | null
  }>({
    variantId: null,
    mode: 'preview',
    validationError: null
  })
  const [newDraft, setNewDraft] = useState<NewVariantDraft | null>(null)
  // The draft's name problems (empty, already taken) sit under the name field;
  // content problems go to the work area like a saved variant's do.
  const [newNameError, setNewNameError] = useState<string | null>(null)
  // The tip under the list: collapsed by default, opens into the example
  // sentence, and once closed with its × it stays closed across launches.
  const [tip, setTip] = useState<'closed' | 'open' | 'dismissed'>(() => (readVariantTipDismissed() ? 'dismissed' : 'closed'))
  const handleDismissTip = (): void => {
    writeVariantTipDismissed()
    setTip('dismissed')
  }
  // The name field edits a local copy; it is written on blur or Enter, so a
  // half-typed name never hits the uniqueness check.
  const [nameEdit, setNameEdit] = useState<{ variantId: string; value: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isNew = selectedVariantId === NEW_VARIANT_ROW_ID
  const summary = useMemo(
    () => (isNew ? null : (variants.find((item) => item.id === selectedVariantId) ?? null)),
    [variants, selectedVariantId, isNew]
  )
  const variant = selectedVariantId && !isNew ? variantsById[selectedVariantId] : undefined
  const draft = useResumeDraft(variant?.content ?? null, variant ? `${variant.id}:${variant.updatedAt}` : 'none', variant?.id ?? 'none')

  useUnsavedSource('resume:variant', draft.dirty)
  // A fresh "New variant" is a copy of the master with no name; it only
  // counts as unsaved work once something has been typed into it.
  useUnsavedSource(
    'resume:newVariant',
    newDraft !== null && (newDraft.name.trim() !== '' || !master || !isSameContent(newDraft.content, master.content))
  )

  // Leaving a variant with unsaved edits (another row, "New variant") asks
  // first. The pending target is kept until the user answers.
  const [pendingSelect, setPendingSelect] = useState<{ target: string | null; andNew: boolean } | null>(null)
  const leaveVariant = (target: string | null, andNew = false): boolean => {
    if (draft.dirty && target !== selectedVariantId) {
      setPendingSelect({ target, andNew })
      return false
    }
    return true
  }
  const selectGuarded = (target: string | null): void => {
    if (leaveVariant(target)) select(target)
  }

  // Selecting a row loads its content; a selection whose variant vanished
  // (deleted from the agent, master removed) is cleared so the panel does
  // not point at nothing. The draft row only exists while there is a draft.
  useEffect(() => {
    if (!selectedVariantId) return
    if (isNew) {
      if (!newDraft) select(null)
      return
    }
    if (loadedOnce && !summary) {
      select(null)
      return
    }
    if (variant === undefined) void loadVariant(selectedVariantId)
  }, [selectedVariantId, isNew, newDraft, summary, loadedOnce, variant, loadVariant, select])

  const mode = viewState.variantId === selectedVariantId ? viewState.mode : isNew ? 'edit' : 'preview'
  const validationError = viewState.variantId === selectedVariantId ? viewState.validationError : null
  const setMode = (next: ResumeWorkMode): void => setViewState({ variantId: selectedVariantId, mode: next, validationError })
  const setValidationError = (next: string | null): void =>
    setViewState({ variantId: selectedVariantId, mode, validationError: next })

  const changeSummary = useMemo(() => {
    if (!master || !variant) return null
    return diffResumeContent(master.content, variant.content).summary
  }, [master, variant])

  if (loadedOnce && !master) {
    return (
      <div className="flex flex-1 flex-col items-start gap-2 p-4">
        <h2 className="text-[13px] font-medium text-text">{t('variants.noMasterTitle')}</h2>
        <p className="max-w-xl text-[12px] text-text-muted">{t('variants.noMasterBody')}</p>
        <Button variant="primary" size="sm" onClick={onGoToMaster}>
          {t('variants.goToMaster')}
        </Button>
      </div>
    )
  }

  const handleNew = (): void => {
    if (!master) return
    if (!leaveVariant(NEW_VARIANT_ROW_ID, true)) return
    startNew()
  }

  const startNew = (): void => {
    if (!master) return
    // Reuse the draft if one is already open rather than throwing its edits away.
    if (!newDraft) {
      setNewDraft({ name: '', content: structuredClone(master.content), templateId: master.templateId })
    }
    setViewState({ variantId: NEW_VARIANT_ROW_ID, mode: 'edit', validationError: null })
    select(NEW_VARIANT_ROW_ID)
  }

  const handleSaveNew = async (): Promise<void> => {
    if (!newDraft) return
    const name = newDraft.name.trim()
    if (!name) {
      setNewNameError(t('variants.nameRequired'))
      return
    }
    // Main rejects a taken name too; checking the loaded list first puts the
    // message on the field instead of in a toast.
    const taken = variants.find((candidate) => resumeVariantNameKey(candidate.name) === resumeVariantNameKey(name))
    if (taken) {
      setNewNameError(t('variants.nameTaken', { name: taken.name }))
      return
    }
    setNewNameError(null)
    const validation = validateResumeContent(newDraft.content)
    if (!validation.ok) {
      setValidationError(validation.message)
      return
    }
    setValidationError(null)
    setSaving(true)
    const result = await saveVariant({ name, content: validation.content, templateId: newDraft.templateId })
    setSaving(false)
    if (result.ok) {
      setNewDraft(null)
      setViewState({ variantId: result.value.id, mode: 'preview', validationError: null })
      select(result.value.id)
      toast.success(t('toast.variantCreated', { name: result.value.name }))
    } else {
      toast.error(errorMessage(result.error))
    }
  }

  const handleDiscardNew = (): void => {
    setNewDraft(null)
    setNewNameError(null)
    select(null)
  }

  const handleSave = async (): Promise<void> => {
    if (!variant || !draft.draft) return
    const validation = validateResumeContent(draft.draft)
    if (!validation.ok) {
      setValidationError(validation.message)
      return
    }
    setValidationError(null)
    setSaving(true)
    const result = await saveVariant({ id: variant.id, name: variant.name, content: validation.content })
    setSaving(false)
    if (result.ok) {
      draft.reset()
      toast.success(t('toast.variantSaved'))
    } else {
      toast.error(errorMessage(result.error))
    }
  }

  const handleRename = async (): Promise<void> => {
    if (!variant || !nameEdit || nameEdit.variantId !== variant.id) return
    const name = nameEdit.value.trim()
    setNameEdit(null)
    if (!name || name === variant.name) return
    setSaving(true)
    const result = await saveVariant({ id: variant.id, name })
    setSaving(false)
    if (result.ok) toast.success(t('toast.variantRenamed', { name: result.value.name }))
    else toast.error(errorMessage(result.error))
  }

  const handleTemplate = async (templateId: ResumeTemplateId): Promise<void> => {
    if (isNew) {
      setNewDraft((current) => (current ? { ...current, templateId } : current))
      return
    }
    if (!variant) return
    setSaving(true)
    const result = await saveVariant({ id: variant.id, name: variant.name, templateId })
    setSaving(false)
    if (!result.ok) toast.error(errorMessage(result.error))
  }

  const handleExport = async (): Promise<void> => {
    if (!variant) return
    setExporting(true)
    const result = await exportPdf(
      { kind: 'variant', id: variant.id },
      { title: t('export.dialogTitle'), filterName: t('export.filterName') }
    )
    setExporting(false)
    if (result.ok && result.filePath) toast.success(t('toast.exported', { path: result.filePath }))
    else if (!result.ok && !result.canceled) toast.error(errorMessage(result.error))
  }

  const handleDelete = async (): Promise<void> => {
    if (!variant) return
    setDeleting(true)
    const result = await deleteVariant(variant.id)
    setDeleting(false)
    setConfirmDelete(false)
    if (result.ok) {
      toast.info(
        result.value.unassignedJobs === 0
          ? t('toast.variantRemovedNone')
          : t('toast.variantRemoved', { count: result.value.unassignedJobs })
      )
    }
    else toast.error(errorMessage(result.error))
  }

  const templateOptions = RESUME_TEMPLATE_IDS.map((id) => ({ value: id, label: t(`templates.${id}.name`) }))
  const nameValue = variant && nameEdit?.variantId === variant.id ? nameEdit.value : (variant?.name ?? '')

  const renderDetailsHeader = (stale: boolean | null): ReactElement => (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{t('details.title')}</span>
      {stale === null ? <span className="text-[11px] text-text-faint">{t('status.unsaved')}</span> : <ResumeStatusTag stale={stale} />}
    </div>
  )

  return (
    <div ref={rowRef} className="flex min-h-0 flex-1">
      <aside
        className="flex min-h-0 shrink-0 flex-col border-r border-border"
        style={{ width: columns.layout.listWidth }}
      >
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3 text-[12px]">
          <span className="min-w-0 truncate font-medium text-text">{t('variants.title')}</span>
          <span className="flex shrink-0 items-center gap-2">
            {loadedOnce && <span className="text-text-faint">{t('variants.count', { count: variants.length })}</span>}
            <Button size="sm" variant="ghost" onClick={handleNew} disabled={!loadedOnce || !master}>
              {t('variants.new')}
            </Button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadedOnce && variants.length === 0 && !newDraft ? (
            <div className="flex flex-col gap-2 p-3">
              <p className="text-[12px] font-medium text-text">{t('variants.emptyTitle')}</p>
              <p className="text-[12px] text-text-muted">{t('variants.emptyBody')}</p>
            </div>
          ) : (
            <VariantList
              variants={variants}
              selectedId={selectedVariantId}
              draftName={newDraft ? newDraft.name : null}
              loaded={loadedOnce}
              onSelect={selectGuarded}
            />
          )}
        </div>
        {tip !== 'dismissed' && (
          <div className="shrink-0 border-t border-border-soft px-3 py-2 text-[11px]">
            <div className="flex items-start gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer text-left leading-relaxed text-text-faint hover:text-text"
                aria-expanded={tip === 'open'}
                onClick={() => setTip((current) => (current === 'open' ? 'closed' : 'open'))}
              >
                <span className="font-medium text-text-muted">{t('variants.tipLabel')}</span> {t('variants.tipBody')}
              </button>
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center text-text-faint hover:text-text"
                aria-label={t('variants.tipDismiss')}
                title={t('variants.tipDismiss')}
                onClick={handleDismissTip}
              >
                ×
              </button>
            </div>
            {tip === 'open' && (
              <div className="mt-2">
                <TailorPromptBlock prompt={{ kind: 'write' }} />
              </div>
            )}
          </div>
        )}
      </aside>
      <ResizeHandle
        orientation="vertical"
        value={columns.layout.listWidth}
        min={LIST_MIN_PX}
        max={LIST_MAX_PX}
        label={t('layout.resizeList')}
        onResize={(next) => columns.setListWidth(next, rowRef.current?.clientWidth, columns.layout.detailsWidth)}
      />

      {isNew && newDraft && master ? (
        <>
          <ResumeWorkArea
            draft={newDraft.content}
            draftVersion={NEW_VARIANT_ROW_ID}
            dirty
            templateId={newDraft.templateId}
            pageSize={master.pageSize}
            style={master.style}
            diffAgainst={master.content}
            mode={mode}
            onModeChange={setMode}
            onDraftChange={(next) => setNewDraft((current) => (current ? { ...current, content: next } : current))}
            saving={saving}
            onSave={() => void handleSaveNew()}
            onDiscard={handleDiscardNew}
            validationError={validationError}
          />
          <ResizeHandle
            orientation="vertical"
            value={columns.layout.detailsWidth}
            min={DETAILS_MIN_PX}
            max={DETAILS_MAX_PX}
            invert
            label={t('layout.resizeDetails')}
            onResize={(next) => columns.setDetailsWidth(next, rowRef.current?.clientWidth, columns.layout.listWidth)}
          />
          <aside
            className="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3"
            style={{ width: columns.layout.detailsWidth }}
          >
            {renderDetailsHeader(null)}
            <TextField
              id="variant-name-new"
              label={t('details.name')}
              placeholder={t('details.namePlaceholder')}
              value={newDraft.name}
              maxLength={RESUME_VARIANT_NAME_MAX_CHARS}
              autoFocus
              onChange={(event) => {
                setNewNameError(null)
                setNewDraft((current) => (current ? { ...current, name: event.target.value } : current))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSaveNew()
              }}
              error={newNameError ?? undefined}
            />
            <Select
              id="variant-template-new"
              label={t('details.template')}
              options={templateOptions}
              value={newDraft.templateId}
              onChange={(value) => void handleTemplate(value as ResumeTemplateId)}
              disabled={saving}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void handleSaveNew()} loading={saving}>
                {saving ? t('actions.saving') : t('actions.save')}
              </Button>
              <Button size="sm" onClick={handleDiscardNew} disabled={saving}>
                {t('actions.discard')}
              </Button>
            </div>
          </aside>
        </>
      ) : !selectedVariantId || !summary ? (
        <div className="flex flex-1 items-center justify-center p-4 text-[12px] text-text-faint">
          {loadedOnce ? t('variants.selectOne') : ''}
        </div>
      ) : variant === undefined ? (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : variant === null || !draft.draft ? (
        <div className="flex flex-1 items-center justify-center p-4 text-[12px] text-danger">
          {t('variants.loadFailed')}
        </div>
      ) : (
        <>
          <ResumeWorkArea
            draft={draft.draft}
            draftVersion={draft.version}
            dirty={draft.dirty}
            templateId={variant.templateId}
            pageSize={master?.pageSize ?? 'letter'}
            style={master?.style ?? {}}
            diffAgainst={master?.content ?? null}
            mode={mode}
            onModeChange={setMode}
            onDraftChange={draft.setDraft}
            saving={saving}
            onSave={() => void handleSave()}
            onDiscard={draft.reset}
            validationError={validationError}
          />
          <ResizeHandle
            orientation="vertical"
            value={columns.layout.detailsWidth}
            min={DETAILS_MIN_PX}
            max={DETAILS_MAX_PX}
            invert
            label={t('layout.resizeDetails')}
            onResize={(next) => columns.setDetailsWidth(next, rowRef.current?.clientWidth, columns.layout.listWidth)}
          />
          <aside
            className="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3"
            style={{ width: columns.layout.detailsWidth }}
          >
            {renderDetailsHeader(variant.stale)}
            <TextField
              id="variant-name"
              label={t('details.name')}
              placeholder={t('details.namePlaceholder')}
              value={nameValue}
              maxLength={RESUME_VARIANT_NAME_MAX_CHARS}
              disabled={saving}
              onChange={(event) => setNameEdit({ variantId: variant.id, value: event.target.value })}
              onBlur={() => void handleRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                if (event.key === 'Escape') setNameEdit(null)
              }}
            />
            <MetaList
              wrap
              items={[
                { key: t('details.updated'), value: format.dateTime(variant.updatedAt) },
                changeSummary && {
                  key: t('details.changes'),
                  value: t('diff.short', {
                    added: changeSummary.added,
                    removed: changeSummary.removed,
                    changed: changeSummary.changed
                  })
                },
                { key: t('details.willAttach'), value: t('details.willAttachJobs', { count: summary.jobCount }) }
              ]}
            />
            <Select
              id="variant-template"
              label={t('details.template')}
              options={templateOptions}
              value={variant.templateId}
              onChange={(value) => void handleTemplate(value as ResumeTemplateId)}
              disabled={saving}
            />
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-text-muted">{t('variants.linkedJobs')}</span>
              {summary.jobs.length === 0 ? (
                <p className="text-[12px] text-text-faint">{t('variants.noLinkedJobs')}</p>
              ) : (
                <ul className="flex flex-col border-t border-border-soft">
                  {summary.jobs.map((job) => (
                    <li key={job.id} className="flex items-center justify-between gap-2 border-b border-border-soft py-1.5">
                      <span className="min-w-0 truncate text-[12px] text-text">
                        {job.title}
                        <span className="text-text-muted">, {job.company}</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => openJob(job.id)}>
                        {t('actions.openJob')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {variant.stale && (
              <Callout tone="warning" title={t('variants.staleTitle')}>
                {t('variants.staleBody')}
              </Callout>
            )}
            {variant.stale && <TailorPromptBlock prompt={{ kind: 'refresh', name: variant.name }} />}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void handleExport()} loading={exporting}>
                {exporting ? t('actions.exporting') : t('actions.exportPdf')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                {t('actions.deleteVariant')}
              </Button>
            </div>
          </aside>
          <ConfirmDialog
            open={confirmDelete}
            title={t('confirm.deleteVariantTitle')}
            message={
              summary.jobCount === 0
                ? t('confirm.deleteVariantMessageNone', { name: variant.name })
                : t('confirm.deleteVariantMessage', { name: variant.name, count: summary.jobCount })
            }
            confirmLabel={t('confirm.deleteVariant')}
            danger
            loading={deleting}
            onConfirm={() => void handleDelete()}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      )}
      <ConfirmDialog
        open={pendingSelect !== null}
        title={t('confirm.discardTitle')}
        message={t('confirm.discardMessage', { name: variant?.name ?? '' })}
        confirmLabel={t('confirm.discard')}
        danger
        onConfirm={() => {
          if (!pendingSelect) return
          draft.reset()
          if (pendingSelect.andNew) startNew()
          else select(pendingSelect.target)
          setPendingSelect(null)
        }}
        onCancel={() => setPendingSelect(null)}
      />
    </div>
  )
}
