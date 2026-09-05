import { useEffect, useState, type ReactElement } from 'react'
import {
  isAdvancedSettingsSnapshot,
  type AdvancedSettingsSnapshot,
  type ApplyerSettingKey
} from '@shared/settings'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import ConfirmDialog from '../ui/ConfirmDialog'
import Spinner from '../ui/Spinner'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useTranslation } from 'react-i18next'
import { searchAdvancedSettingsSections } from './advancedSettingsSections'
import SettingsDisclosure from './SettingsDisclosure'

function humanize(value: string): string {
  const withoutWarning = value.replace(/^dangerous/, '')
  return withoutWarning
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bAts\b/g, 'ATS')
    .replace(/\bCsv\b/g, 'CSV')
    .replace(/\bMcp\b/g, 'MCP')
    .replace(/\bTtl\b/g, 'TTL')
    .replace(/\bMs\b/g, 'ms')
    .replace(/\bId\b/g, 'ID')
    .replace(/^./, (character) => character.toUpperCase())
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function editableValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value)
}

function parseDraft(draft: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === 'number') return Number(draft)
  if (typeof defaultValue === 'string') return draft
  return JSON.parse(draft) as unknown
}

interface SettingControlProps {
  settingKey: ApplyerSettingKey
  value: unknown
  defaultValue: unknown
  overridden: boolean
  saving: boolean
  onSave: (key: ApplyerSettingKey, value: unknown) => Promise<void>
  onReset: (key: ApplyerSettingKey) => Promise<void>
}

function SettingControl({
  settingKey,
  value,
  defaultValue,
  overridden,
  saving,
  onSave,
  onReset
}: SettingControlProps): ReactElement {
  const { t } = useTranslation('settings')
  const [draft, setDraft] = useState(() => editableValue(value))
  const [draftError, setDraftError] = useState<string | null>(null)
  const [pendingDangerousValue, setPendingDangerousValue] = useState<unknown>(undefined)
  const dangerous = settingKey.startsWith('dangerous')
  const dirty = draft !== editableValue(value)

  const saveValue = async (next: unknown): Promise<void> => {
    setDraftError(null)
    await onSave(settingKey, next)
  }

  const requestSave = (next: unknown): void => {
    if (dangerous) {
      setPendingDangerousValue(next)
    } else {
      void saveValue(next)
    }
  }

  const saveDraft = (): void => {
    if (typeof defaultValue === 'number') {
      const parsed = Number(draft)
      if (!Number.isFinite(parsed)) {
        setDraftError(t('developer.invalidNumber'))
        return
      }
      requestSave(parsed)
      return
    }
    try {
      const parsed = parseDraft(draft, defaultValue)
      requestSave(parsed)
    } catch {
      setDraftError(t('developer.invalidJson'))
    }
  }

  return (
    <div className="grid grid-cols-[minmax(9rem,0.45fr)_minmax(0,1fr)] gap-3 py-2">
      <div className="min-w-0 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-text">{humanize(settingKey)}</span>
          {dangerous && <span className="text-[10px] font-semibold uppercase text-danger">{t('developer.dangerous')}</span>}
          {overridden && <span className="text-[10px] text-accent">{t('developer.overridden')}</span>}
        </div>
        <code className="break-all text-[10px] text-text-faint">{settingKey}</code>
      </div>

      <div className="min-w-0">
        {typeof defaultValue === 'boolean' ? (
          <div className="flex items-start justify-between gap-2">
            <Checkbox
              id={`advanced-${settingKey}`}
              label={value ? t('developer.enabled') : t('developer.disabled')}
              checked={Boolean(value)}
              disabled={saving}
              onChange={(checked) => requestSave(checked)}
            />
            <Button size="sm" variant="ghost" disabled={!overridden || saving} onClick={() => void onReset(settingKey)}>
              {t('developer.reset')}
            </Button>
          </div>
        ) : typeof defaultValue === 'number' || typeof defaultValue === 'string' ? (
          <div className="flex items-center gap-2">
            <input
              aria-label={t('developer.valueFor', { setting: settingKey })}
              type={typeof defaultValue === 'number' ? 'number' : 'text'}
              step={typeof defaultValue === 'number' ? 'any' : undefined}
              value={draft}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value)
                setDraftError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dirty) saveDraft()
              }}
              className={`h-7 min-w-0 flex-1 border bg-canvas-soft px-2 text-[13px] text-text outline-none focus:border-accent ${
                draftError ? 'border-danger' : 'border-border'
              }`}
            />
            <Button size="sm" loading={saving} disabled={!dirty} onClick={saveDraft}>
              {t('developer.save')}
            </Button>
            <Button size="sm" variant="ghost" disabled={!overridden || saving} onClick={() => void onReset(settingKey)}>
              {t('developer.reset')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <textarea
              aria-label={t('developer.jsonValue', { setting: settingKey })}
              value={draft}
              disabled={saving}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value)
                setDraftError(null)
              }}
              className={`min-h-24 resize-y border bg-canvas-inset p-2 font-mono text-[11px] text-text outline-none focus:border-accent ${
                draftError ? 'border-danger' : 'border-border'
              }`}
            />
            <div className="flex items-center justify-between gap-2">
              <span className={draftError ? 'text-[11px] text-danger' : 'text-[11px] text-text-faint'}>
                {draftError ?? t('developer.jsonHint')}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" loading={saving} disabled={!dirty} onClick={saveDraft}>
                  {t('developer.save')}
                </Button>
                <Button size="sm" variant="ghost" disabled={!overridden || saving} onClick={() => void onReset(settingKey)}>
                  {t('developer.reset')}
                </Button>
              </div>
            </div>
          </div>
        )}

        <span className="block break-all text-[10px] text-text-faint">
          {t('developer.defaultValue', { value: displayValue(defaultValue) })}
        </span>
        {draftError && (typeof defaultValue === 'number' || typeof defaultValue === 'string') && (
          <span className="block text-[11px] text-danger">{draftError}</span>
        )}
      </div>

      <ConfirmDialog
        open={pendingDangerousValue !== undefined}
        title={t('developer.dangerousTitle')}
        message={t('developer.dangerousMessage', { setting: settingKey })}
        confirmLabel={t('developer.dangerousConfirm')}
        danger
        loading={saving}
        onConfirm={() => {
          const pending = pendingDangerousValue
          setPendingDangerousValue(undefined)
          void saveValue(pending)
        }}
        onCancel={() => setPendingDangerousValue(undefined)}
      />
    </div>
  )
}

export default function AdvancedSettingsEditor(): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [snapshot, setSnapshot] = useState<AdvancedSettingsSnapshot | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [savingKey, setSavingKey] = useState<ApplyerSettingKey | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const load = (): void => {
    setLoadError(false)
    window.api.settings
      .getAdvanced()
      .then((next) => {
        if (!isAdvancedSettingsSnapshot(next)) throw new Error('Malformed advanced settings')
        setSnapshot(next)
      })
      .catch(() => setLoadError(true))
  }

  useEffect(() => {
    let active = true
    window.api.settings
      .getAdvanced()
      .then((next) => {
        if (!isAdvancedSettingsSnapshot(next)) throw new Error('Malformed advanced settings')
        if (active) setSnapshot(next)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [])

  const save = async (key: ApplyerSettingKey, value: unknown): Promise<void> => {
    setSavingKey(key)
    try {
      const result = await window.api.settings.updateAdvanced(key, value)
      if (result.ok) {
        if (!isAdvancedSettingsSnapshot(result.snapshot)) {
          setLoadError(true)
          return
        }
        setSnapshot(result.snapshot)
        toast.success(t('developer.saved'))
      } else {
        toast.error(errorMessage(result.error))
      }
    } catch {
      toast.error(t('developer.saveFailed'))
    } finally {
      setSavingKey(null)
    }
  }

  const reset = async (key: ApplyerSettingKey): Promise<void> => {
    setSavingKey(key)
    try {
      const result = await window.api.settings.resetAdvanced(key)
      if (result.ok) {
        if (!isAdvancedSettingsSnapshot(result.snapshot)) {
          setLoadError(true)
          return
        }
        setSnapshot(result.snapshot)
        toast.success(t('developer.resetDone'))
      } else {
        toast.error(errorMessage(result.error))
      }
    } catch {
      toast.error(t('developer.resetFailed'))
    } finally {
      setSavingKey(null)
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-danger">
        <span>{t('developer.loadFailed')}</span>
        <Button size="sm" onClick={load}>{t('developer.retry')}</Button>
      </div>
    )
  }

  if (!snapshot) {
    return <Spinner className="h-4 w-4" />
  }

  const sectionLabels: Record<string, string> = {
    system: t('developer.sections.system'),
    documents: t('developer.sections.documents'),
    jobs: t('developer.sections.jobs'),
    companyBoards: t('developer.sections.companyBoards'),
    notifications: t('developer.sections.notifications'),
    terminal: t('developer.sections.terminal')
  }
  const groupLabels: Record<string, string> = {
    failureTags: t('developer.groups.failureTags'),
    uploads: t('developer.groups.uploads'),
    listing: t('developer.groups.listing'),
    indexedJobs: t('developer.groups.indexedJobs'),
    exclusions: t('developer.groups.exclusions'),
    detailsCache: t('developer.groups.detailsCache'),
    capacity: t('developer.groups.capacity'),
    csvImport: t('developer.groups.csvImport'),
    fetching: t('developer.groups.fetching'),
    cache: t('developer.groups.cache'),
    notificationDefaults: t('developer.groups.notificationDefaults'),
    commands: t('developer.groups.commands')
  }

  const labels = { ...sectionLabels, ...groupLabels }
  const visibleSections = searchAdvancedSettingsSections(searchQuery, labels)
  const searching = searchQuery.trim().length > 0

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint"
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          aria-label={t('developer.searchLabel')}
          placeholder={t('developer.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-7 w-full border border-border bg-canvas-soft pl-7 pr-2 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
      </div>

      {snapshot.restartRequired && (
        <div className="border border-warning px-2 py-1.5 text-[11px] text-warning">{t('developer.restartRequired')}</div>
      )}
      {snapshot.warnings.length > 0 && (
        <div className="border border-warning px-2 py-1.5 text-[11px] text-warning">
          {snapshot.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}

      {visibleSections.length === 0 && (
        <p className="py-4 text-center text-[12px] text-text-faint">{t('developer.noSearchResults')}</p>
      )}

      {visibleSections.map((section, sectionIndex) => (
        <SettingsDisclosure
          key={section.id}
          label={sectionLabels[section.id] ?? humanize(section.id)}
          defaultOpen={sectionIndex === 0}
          forceOpen={searching}
        >
          <div className="flex flex-col gap-1.5">
            {section.groups.map((group) => (
              <SettingsDisclosure
                key={group.id}
                label={groupLabels[group.id] ?? humanize(group.id)}
                forceOpen={searching}
                nested
              >
                {group.keys.map((key) => (
                  <SettingControl
                    key={`${key}:${displayValue(snapshot.configured[key])}`}
                    settingKey={key}
                    value={snapshot.configured[key]}
                    defaultValue={snapshot.defaults[key]}
                    overridden={snapshot.overriddenKeys.includes(key)}
                    saving={savingKey === key}
                    onSave={save}
                    onReset={reset}
                  />
                ))}
              </SettingsDisclosure>
            ))}
          </div>
        </SettingsDisclosure>
      ))}
    </div>
  )
}
