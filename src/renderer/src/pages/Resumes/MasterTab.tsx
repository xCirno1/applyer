import { useRef, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  EMPTY_RESUME_CONTENT,
  RESUME_PAGE_SIZES,
  RESUME_TEMPLATE_IDS,
  type ResumeContact,
  type ResumeFallbackAttachment,
  type ResumePageSize,
  type ResumeTemplateId,
  RESUME_FONT_FAMILIES,
  RESUME_FONT_SIZES_PT,
  RESUME_LINK_STYLES,
  isResumeFontFamily,
  isResumeLinkStyle,
  normalizeResumeFontSize,
  type ResumeStyle
} from '@shared/types/resume'
import { validateResumeContent } from '@shared/resume/resumeContentSchema'
import { useResumesStore } from '../../state/resumesStore'
import { useProfileStore } from '../../state/profileStore'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import Button from '../../components/ui/Button'
import Checkbox from '../../components/ui/Checkbox'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import MetaList from '../../components/ui/MetaList'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import Tooltip from '../../components/ui/Tooltip'
import ResumeWorkArea, { type ResumeWorkMode } from '../../components/resume/ResumeWorkArea'
import TailorPromptBlock from '../../components/resume/TailorPromptBlock'
import ResizeHandle from '../../components/ui/ResizeHandle'
import { DETAILS_MAX_PX, DETAILS_MIN_PX } from './resumesLayout'
import type { ResumesLayoutController } from './useResumesLayout'
import { useResumeDraft } from './useResumeDraft'
import { useUnsavedSource } from '../../state/unsavedChangesStore'

/*
 * Master tab: work area | details. The details column also holds the two
 * resume settings (fallback attachment, auto-tailor) because they only mean
 * something in relation to the master, and a user deciding "render the
 * master when there is no variant" wants to be looking at the master.
 *
 * With no master yet the tab is the on-ramp: the sentence to paste for the
 * agent (importing the upload is the normal path) and a "start empty" button
 * for people who would rather type.
 */

/** Option value standing for "no override" in the typography selects; never a real family or size. */
const TEMPLATE_DEFAULT = 'template'

export default function MasterTab({ columns }: { columns: ResumesLayoutController }): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null)
  // Same re-clamp on the row's width as the Variants tab, for the one side column here.
  const { setDetailsWidth } = columns
  const { detailsWidth } = columns.layout
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const reclamp = (): void => {
      const available = row.clientWidth
      if (available > 0) setDetailsWidth(detailsWidth, available)
    }
    reclamp()
    const observer = new ResizeObserver(reclamp)
    observer.observe(row)
    return () => observer.disconnect()
  }, [setDetailsWidth, detailsWidth])
  const { t } = useTranslation('resumes')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const format = useFormatters()
  const master = useResumesStore((s) => s.master)
  const settings = useResumesStore((s) => s.settings)
  const variants = useResumesStore((s) => s.variants)
  const loadedOnce = useResumesStore((s) => s.loadedOnce)
  const saveMaster = useResumesStore((s) => s.saveMaster)
  const deleteMaster = useResumesStore((s) => s.deleteMaster)
  const setSettings = useResumesStore((s) => s.setSettings)
  const exportPdf = useResumesStore((s) => s.exportPdf)
  const documents = useProfileStore((s) => s.documents)
  const profile = useProfileStore((s) => s.profile)
  const profileLoaded = useProfileStore((s) => s.loaded)
  const fetchProfile = useProfileStore((s) => s.fetch)

  const [mode, setMode] = useState<ResumeWorkMode>('preview')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // The empty state names the uploaded resume, and the details panel names
  // the upload the master was imported from; both come from the profile store.
  useEffect(() => {
    if (!profileLoaded) void fetchProfile()
  }, [profileLoaded, fetchProfile])

  const draft = useResumeDraft(master?.content ?? null, master ? master.updatedAt : 'none', 'master')
  useUnsavedSource('resume:master', draft.dirty)
  const uploadedResume = documents.find((document) => document.kind === 'resume') ?? null
  const sourceDocument = master?.sourceDocumentId
    ? documents.find((document) => document.id === master.sourceDocumentId)
    : undefined

  if (!loadedOnce) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // "Start empty" is really "start from the profile": the header is the one
  // part of a resume the app already knows, and a name is required anyway.
  const handleCreateEmpty = async (): Promise<void> => {
    setCreating(true)
    const contacts: ResumeContact[] = []
    if (profile.email)
      contacts.push({ id: 'contact-email', label: '', value: profile.email, url: `mailto:${profile.email}` })
    if (profile.phone) contacts.push({ id: 'contact-phone', label: '', value: profile.phone })
    if (profile.location) contacts.push({ id: 'contact-location', label: '', value: profile.location })
    for (const [id, url] of [
      ['contact-linkedin', profile.linkedinUrl],
      ['contact-github', profile.githubUrl],
      ['contact-portfolio', profile.portfolioUrl]
    ] as const) {
      if (url) contacts.push({ id, label: '', value: url, url })
    }
    const result = await saveMaster({
      content: {
        ...EMPTY_RESUME_CONTENT,
        header: { fullName: profile.fullName.trim() || t('editor.fullName'), contacts }
      }
    })
    setCreating(false)
    if (result.ok) {
      setMode('edit')
      toast.success(t('toast.masterSaved'))
    } else {
      toast.error(errorMessage(result.error))
    }
  }

  if (!master) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="max-w-xl">
          <h2 className="text-[13px] font-medium text-text">{t('master.emptyTitle')}</h2>
          <p className="mt-1 text-[12px] text-text-muted">
            {uploadedResume ? t('master.emptyBody') : t('master.emptyBodyNoUpload')}
          </p>
        </div>
        <div className="max-w-xl">
          <TailorPromptBlock prompt={{ kind: 'import', hasUpload: uploadedResume !== null }} />
        </div>
        <div>
          <Button size="sm" onClick={() => void handleCreateEmpty()} loading={creating}>
            {t('actions.createEmpty')}
          </Button>
        </div>
      </div>
    )
  }

  const handleSave = async (): Promise<void> => {
    if (!draft.draft) return
    const validation = validateResumeContent(draft.draft)
    if (!validation.ok) {
      setValidationError(validation.message)
      return
    }
    setValidationError(null)
    setSaving(true)
    const result = await saveMaster({ content: validation.content })
    setSaving(false)
    if (result.ok) {
      draft.reset()
      toast.success(t('toast.masterSaved'))
    } else {
      toast.error(errorMessage(result.error))
    }
  }

  const handleLayoutSetting = async (patch: {
    templateId?: ResumeTemplateId
    pageSize?: ResumePageSize
    style?: ResumeStyle
  }): Promise<void> => {
    setSaving(true)
    const result = await saveMaster({ content: master.content, ...patch })
    setSaving(false)
    if (!result.ok) toast.error(errorMessage(result.error))
  }

  const handleSettings = async (patch: Partial<typeof settings>): Promise<void> => {
    setSettingsSaving(true)
    const result = await setSettings({ ...settings, ...patch })
    setSettingsSaving(false)
    if (result.ok) toast.success(t('toast.settingsSaved'))
    else toast.error(errorMessage(result.error))
  }

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    const result = await exportPdf(
      { kind: 'master' },
      { title: t('export.dialogTitle'), filterName: t('export.filterName') }
    )
    setExporting(false)
    if (result.ok && result.filePath) toast.success(t('toast.exported', { path: result.filePath }))
    else if (!result.ok && !result.canceled) toast.error(errorMessage(result.error))
  }

  const handleDelete = async (): Promise<void> => {
    setDeleting(true)
    const result = await deleteMaster()
    setDeleting(false)
    setConfirmDelete(false)
    if (result.ok) toast.info(t('toast.masterDeleted'))
    else toast.error(errorMessage(result.error))
  }

  const staleCount = variants.filter((variant) => variant.stale).length

  return (
    <div ref={rowRef} className="flex min-h-0 flex-1">
      {draft.draft && (
        <ResumeWorkArea
          draft={draft.draft}
          draftVersion={draft.version}
          dirty={draft.dirty}
          templateId={master.templateId}
          pageSize={master.pageSize}
          style={master.style}
          mode={mode}
          onModeChange={setMode}
          onDraftChange={draft.setDraft}
          saving={saving}
          onSave={() => void handleSave()}
          onDiscard={draft.reset}
          validationError={validationError}
        />
      )}
      <ResizeHandle
        orientation="vertical"
        value={columns.layout.detailsWidth}
        min={DETAILS_MIN_PX}
        max={DETAILS_MAX_PX}
        invert
        label={t('layout.resizeDetails')}
        onResize={(next) => columns.setDetailsWidth(next, rowRef.current?.clientWidth)}
      />
      <aside
        className="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3"
        style={{ width: columns.layout.detailsWidth }}
      >
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{t('details.title')}</span>
        <MetaList
          wrap
          items={[
            { key: t('details.updated'), value: format.dateTime(master.updatedAt) },
            {
              key: t('details.source'),
              value: master.sourceDocumentId
                ? (sourceDocument?.originalFilename ?? t('details.sourceRemoved'))
                : t('details.sourceNone')
            },
            staleCount > 0 && { key: t('status.stale'), value: t('variants.count', { count: staleCount }) }
          ]}
        />
        <Select
          id="master-template"
          label={t('master.defaultTemplate')}
          options={RESUME_TEMPLATE_IDS.map((id) => ({ value: id, label: t(`templates.${id}.name`) }))}
          value={master.templateId}
          onChange={(value) => void handleLayoutSetting({ templateId: value as ResumeTemplateId })}
          disabled={saving}
        />
        <Select
          id="master-page-size"
          label={t('details.pageSize')}
          options={RESUME_PAGE_SIZES.map((size) => ({
            value: size,
            label: size === 'letter' ? t('master.pageSizeLetter') : t('master.pageSizeA4')
          }))}
          value={master.pageSize}
          onChange={(value) => void handleLayoutSetting({ pageSize: value as ResumePageSize })}
          disabled={saving}
        />
        <Select
          id="master-font-family"
          label={t('details.fontFamily')}
          options={[
            { value: TEMPLATE_DEFAULT, label: t('master.templateDefault') },
            ...RESUME_FONT_FAMILIES.map((family) => ({ value: family, label: t(`fonts.${family}`) }))
          ]}
          value={master.style.fontFamily ?? TEMPLATE_DEFAULT}
          onChange={(value) =>
            void handleLayoutSetting({
              style: { ...master.style, fontFamily: isResumeFontFamily(value) ? value : undefined }
            })
          }
          disabled={saving}
        />
        <Select
          id="master-font-size"
          label={t('details.fontSize')}
          options={[
            { value: TEMPLATE_DEFAULT, label: t('master.templateDefault') },
            ...RESUME_FONT_SIZES_PT.map((size) => ({ value: String(size), label: t('master.fontSizePt', { size }) }))
          ]}
          value={master.style.fontSize === undefined ? TEMPLATE_DEFAULT : String(master.style.fontSize)}
          onChange={(value) =>
            void handleLayoutSetting({ style: { ...master.style, fontSize: normalizeResumeFontSize(value) } })
          }
          disabled={saving}
        />
        <Select
          id="master-link-style"
          label={t('details.linkStyle')}
          options={RESUME_LINK_STYLES.map((linkStyle) => ({ value: linkStyle, label: t(`linkStyles.${linkStyle}`) }))}
          value={master.style.linkStyle ?? 'plain'}
          onChange={(value) =>
            void handleLayoutSetting({
              style: { ...master.style, linkStyle: isResumeLinkStyle(value) ? value : undefined }
            })
          }
          disabled={saving}
        />
        <Tooltip label={t('master.fallbackHint')}>
          <div>
            <Select
              id="resume-fallback"
              label={t('master.fallback')}
              options={[
                { value: 'original', label: t('master.fallbackOriginal') },
                { value: 'master', label: t('master.fallbackMaster') }
              ]}
              value={settings.fallbackAttachment}
              onChange={(value) => void handleSettings({ fallbackAttachment: value as ResumeFallbackAttachment })}
              disabled={settingsSaving}
            />
          </div>
        </Tooltip>
        <Checkbox
          id="resume-auto-tailor"
          label={t('master.autoTailor')}
          hint={t('master.autoTailorHint')}
          checked={settings.autoTailor}
          onChange={(checked) => void handleSettings({ autoTailor: checked })}
          disabled={settingsSaving}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void handleExport()} loading={exporting}>
            {exporting ? t('actions.exporting') : t('actions.exportPdf')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
            {t('actions.deleteMaster')}
          </Button>
        </div>
      </aside>
      <ConfirmDialog
        open={confirmDelete}
        title={t('confirm.deleteMasterTitle')}
        message={t('confirm.deleteMasterMessage')}
        confirmLabel={t('confirm.deleteMaster')}
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
