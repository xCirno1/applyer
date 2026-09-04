import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Dropdown from '../ui/Dropdown'
import Modal from '../ui/Modal'
import MetaList, { type MetaEntry } from '../ui/MetaList'
import Skeleton from '../ui/Skeleton'
import TextField from '../ui/TextField'
import Tooltip from '../ui/Tooltip'
import { PROVIDER_LABELS } from './boardColumns'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import { MAX_COMPANY_BOARDS } from '@shared/constants'
import {
  BOARD_CSV_FIELDS,
  emptyBoardCsvMapping,
  type BoardCsvCapacity,
  type BoardCsvField,
  type BoardCsvFile,
  type BoardCsvMapping,
  type BoardCsvPlan
} from '@shared/types/companyBoard'

/**
 * Bulk-adding tracked boards from a CSV of ATS board tokens.
 *
 * The watchlist is the entire coverage of Greenhouse/Lever/Ashby/Workday
 * (none of them has a cross-company search), so filling it one company at a
 * time is the feature's real cost. Published open-data feeds of board tokens
 * exist, and this takes any of them: the file's columns are matched to the
 * fields Applyer needs here rather than by requiring particular header names,
 * so one feed's `provider,token,open_postings` and a hand-kept spreadsheet's
 * own layout both work.
 *
 * Everything the dialog reports comes from the main process re-planning the
 * real file against the current mapping, not from a client-side guess, so the
 * preview and the import cannot disagree. It re-plans on a short debounce as
 * the mapping and the two numbers change.
 *
 * The size floor is not a nicety. A slug left behind when a company moves ATS
 * provider keeps answering for years with an empty board, and those are the
 * majority of stale rows in a crawled feed, so importing without a floor
 * spends a watchlist's capacity on boards that can never return a posting.
 */

/** How long the mapping has to stop changing before the main process re-plans. */
const PLAN_DEBOUNCE_MS = 200

interface Props {
  open: boolean
  onClose: () => void
}

interface Loaded {
  file: BoardCsvFile
  capacity: BoardCsvCapacity
}

export default function BoardCsvImportModal({ open, onClose }: Props): ReactElement | null {
  const { t } = useTranslation('indexedJobs')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const format = useFormatters()

  const [picking, setPicking] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<BoardCsvMapping>(emptyBoardCsvMapping())
  const [minOpen, setMinOpen] = useState('1')
  const [maxImport, setMaxImport] = useState('')
  // The plan is stored with the settings it was computed for, never on its
  // own: the two must be compared, since a plan for the previous mapping is
  // a preview of an import that would no longer happen.
  const [planned, setPlanned] = useState<{ key: string; plan: BoardCsvPlan } | null>(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // Only the newest plan request may write state: the debounce still lets a
  // slow one overlap a newer one, and a stale answer here would show counts
  // for a mapping the user has already changed.
  const planSeq = useRef(0)

  const reset = useCallback((): void => {
    planSeq.current++
    window.api.companyBoards.releaseCsv()
    setLoaded(null)
    setMapping(emptyBoardCsvMapping())
    setMinOpen('1')
    setMaxImport('')
    setPlanned(null)
    setPlanning(false)
    setError(null)
  }, [])

  const options = useMemo(() => {
    const parsedMin = Number.parseInt(minOpen, 10)
    const parsedMax = Number.parseInt(maxImport, 10)
    const remaining = loaded?.capacity.remaining ?? 0
    return {
      minOpenPostings: Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 0,
      maxImport: Number.isFinite(parsedMax) && parsedMax > 0 ? Math.min(parsedMax, MAX_COMPANY_BOARDS) : remaining
    }
  }, [minOpen, maxImport, loaded])

  /**
   * Everything the main process would re-plan from, as one comparable value.
   *
   * The dialog's contract is that the preview and the write cannot disagree,
   * and the write re-plans from these exact settings — so "is the preview
   * still true?" is precisely "are these the settings it was computed for?".
   * Deriving that beats trying to invalidate the plan from an effect, which
   * would leave the old preview standing for the length of the debounce.
   */
  const settingsKey = useMemo(
    () => JSON.stringify({ filePath: loaded?.file.filePath ?? null, mapping, options }),
    [loaded, mapping, options]
  )

  const stale = planned === null || planned.key !== settingsKey
  const plan = stale ? null : planned.plan
  /** The last preview, shown dimmed while a newer one is on its way rather than blanking the dialog. */
  const shownPlan = planned?.plan ?? null

  useEffect(() => {
    if (!open || !loaded) return

    const seq = ++planSeq.current
    // The spinner is raised inside the timeout, not in the effect body: a
    // synchronous setState here would cascade a render on every keystroke in
    // the two number fields, and the debounce is what this is waiting on
    // anyway. Staleness does not depend on it — `stale` below is derived from
    // the settings the standing plan was computed for, so the Import button
    // is disabled from the instant a dropdown or a number changes rather than
    // from whenever this timer gets round to firing.
    const timer = window.setTimeout(() => {
      setPlanning(true)
      window.api.companyBoards
        .planCsv(loaded.file.filePath, mapping, options)
        .then((result) => {
          if (seq !== planSeq.current) return
          if (result.ok) {
            setPlanned({ key: settingsKey, plan: result.plan })
            setError(null)
          } else {
            setPlanned(null)
            setError(errorMessage(result.error))
          }
        })
        .catch(() => {
          if (seq !== planSeq.current) return
          setPlanned(null)
          setError(t('boards.csv.planFailed'))
        })
        .finally(() => {
          if (seq === planSeq.current) setPlanning(false)
        })
    }, PLAN_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [open, loaded, mapping, options, settingsKey, errorMessage, t])

  if (!open) return null

  const handleClose = (): void => {
    if (importing) return
    reset()
    onClose()
  }

  const handlePick = async (): Promise<void> => {
    setPicking(true)
    setError(null)
    try {
      const result = await window.api.companyBoards.pickCsv({
        title: t('boards.csv.dialogTitle'),
        filterName: t('boards.csv.filterName')
      })
      if (!result.ok) {
        if ('canceled' in result) return
        // A file that could not be used is a failed pick, not a lost one:
        // whatever was already loaded stays loaded (the main process keeps it
        // too), so the dialog carries on describing a file that still exists
        // rather than leaving Import to fail on one that never landed.
        setError(errorMessage(result.error))
        return
      }
      planSeq.current++
      setPlanned(null)
      setLoaded({ file: result.file, capacity: result.capacity })
      setMapping(result.file.suggestedMapping)
      setMaxImport(String(result.capacity.remaining))
    } finally {
      setPicking(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    if (!loaded || !plan || plan.willImport === 0) return
    setImporting(true)
    try {
      const result = await window.api.companyBoards.importCsv(loaded.file.filePath, mapping, options)
      if (!result.ok) {
        toast.error(errorMessage(result.error))
        return
      }

      const { imported, skipped, alreadyTracked, totalRows } = result.summary
      if (imported === 0) {
        toast.info(t('boards.csv.importedNone'))
      } else {
        const dropped = skipped + alreadyTracked
        toast.success(
          dropped > 0
            ? `${t('boards.csv.imported', { count: imported })} ${t('boards.csv.importedSkipped', {
                skipped: format.number(dropped),
                total: format.number(totalRows)
              })}`
            : t('boards.csv.imported', { count: imported })
        )
      }
      reset()
      onClose()
    } finally {
      setImporting(false)
    }
  }

  const columnOptions = [
    { value: '', label: t('boards.csv.unmapped') },
    ...(loaded?.file.headers ?? []).map((header, index) => ({
      value: String(index),
      // A file can carry two columns with the same name, and a blank header
      // is not addressable by name at all, so the position is always shown.
      label: header ? `${index + 1}. ${header}` : `${index + 1}.`
    }))
  ]

  const fieldLabels: Record<BoardCsvField, string> = {
    company: t('boards.csv.fieldCompany'),
    provider: t('boards.csv.fieldProvider'),
    token: t('boards.csv.fieldToken'),
    openPostings: t('boards.csv.fieldOpenPostings'),
    boardUrl: t('boards.csv.fieldBoardUrl'),
    apiUrl: t('boards.csv.fieldApiUrl')
  }

  /** The first row's value for a field, so a wrong column is visible without importing. */
  const sampleValue = (field: BoardCsvField): string => {
    const index = mapping[field]
    if (index === null || !loaded) return ''
    return loaded.file.sampleRows[0]?.[index]?.trim() ?? ''
  }

  const planEntries: MetaEntry[] = shownPlan
    ? [
        shownPlan.alreadyTracked > 0 && {
          key: 'tracked',
          value: t('boards.csv.planAlreadyTracked', { count: shownPlan.alreadyTracked })
        },
        shownPlan.duplicates > 0 && { key: 'dupes', value: t('boards.csv.planDuplicates', { count: shownPlan.duplicates }) },
        shownPlan.belowThreshold > 0 && {
          key: 'below',
          value: t('boards.csv.planBelowThreshold', { count: shownPlan.belowThreshold })
        },
        shownPlan.unusable > 0 && { key: 'unusable', value: t('boards.csv.planUnusable', { count: shownPlan.unusable }) },
        shownPlan.overLimit > 0 && { key: 'over', value: t('boards.csv.planOverLimit', { count: shownPlan.overLimit }) }
      ]
    : []

  return (
    <Modal open={open} onClose={handleClose} title={t('boards.csv.title')} width="max-w-3xl">
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-text-muted">{t('boards.csv.intro')}</p>

        {!loaded ? (
          <div>
            <Button onClick={handlePick} loading={picking}>
              {t('boards.csv.choose')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border border-border bg-canvas-soft px-3 py-1.5">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] text-text" title={loaded.file.filePath}>
                  {loaded.file.fileName}
                </span>
                <MetaList
                  className="text-[11px] text-text-faint"
                  items={[
                    { key: 'rows', value: t('boards.csv.rowCount', { count: loaded.file.rowCount }) },
                    loaded.file.truncated && {
                      key: 'truncated',
                      value: t('boards.csv.truncated', { count: loaded.file.rowCount })
                    }
                  ]}
                />
              </div>
              <Button size="sm" variant="ghost" onClick={handlePick} loading={picking} disabled={importing}>
                {t('boards.csv.chooseAnother')}
              </Button>
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] uppercase tracking-[0.08em] text-text-faint">{t('boards.csv.mappingTitle')}</h3>
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3">
                {BOARD_CSV_FIELDS.map((field) => {
                  const sample = sampleValue(field)
                  return (
                    <div key={field} className="flex min-w-0 flex-col gap-1">
                      <span className="text-[12px] font-medium text-text-muted">
                        {field === 'token' ? (
                          <Tooltip label={t('boards.csv.fieldTokenTip')}>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">
                              {fieldLabels[field]}
                            </span>
                          </Tooltip>
                        ) : (
                          fieldLabels[field]
                        )}
                      </span>
                      <Dropdown
                        options={columnOptions}
                        value={mapping[field] === null ? '' : String(mapping[field])}
                        ariaLabel={fieldLabels[field]}
                        disabled={importing}
                        onChange={(value) =>
                          setMapping((prev) => ({ ...prev, [field]: value === '' ? null : Number(value) }))
                        }
                      />
                      <span className="truncate text-[11px] text-text-faint" title={sample}>
                        {sample}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] uppercase tracking-[0.08em] text-text-faint">{t('boards.csv.optionsTitle')}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField
                  label={t('boards.csv.minOpenLabel')}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={minOpen}
                  disabled={importing || mapping.openPostings === null}
                  hint={
                    mapping.openPostings === null ? t('boards.csv.minOpenDisabled') : t('boards.csv.minOpenHint')
                  }
                  onChange={(e) => setMinOpen(e.target.value)}
                />
                <TextField
                  label={t('boards.csv.maxImportLabel')}
                  type="number"
                  min={1}
                  max={MAX_COMPANY_BOARDS}
                  inputMode="numeric"
                  value={maxImport}
                  disabled={importing}
                  hint={t('boards.csv.maxImportHint', {
                    remaining: format.number(loaded.capacity.remaining),
                    limit: format.number(loaded.capacity.limit)
                  })}
                  onChange={(e) => setMaxImport(e.target.value)}
                />
              </div>
            </section>

            <section className="flex flex-col gap-2 border-t border-border-soft pt-3">
              <h3 className="text-[11px] uppercase tracking-[0.08em] text-text-faint">{t('boards.csv.planTitle')}</h3>

              {error ? (
                <p className="text-[12px] text-danger">{error}</p>
              ) : !shownPlan ? (
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : (
                <>
                  <div className={`flex flex-col gap-0.5 ${stale ? 'opacity-60' : ''}`}>
                    <span className="text-[13px] text-text">
                      {t('boards.csv.willImport', { count: shownPlan.willImport })}
                    </span>
                    <MetaList className="text-[11px] text-text-faint" items={planEntries} />
                  </div>

                  {shownPlan.sample.length > 0 && (
                    <div className={`border border-border ${stale ? 'opacity-60' : ''}`}>
                      <div className="border-b border-border bg-canvas-inset px-3 py-1 text-[10px] uppercase tracking-[0.08em] text-text-faint">
                        {t('boards.csv.previewTitle')}
                      </div>
                      <ul>
                        {shownPlan.sample.map((row) => (
                          <li
                            key={`${row.provider}:${row.token}:${row.site ?? ''}`}
                            className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-1.5 text-[12px] last:border-0"
                          >
                            <span className="truncate text-text" title={row.companyName}>
                              {row.companyName}
                            </span>
                            <MetaList
                              className="shrink-0 text-[11px] text-text-faint"
                              items={[
                                { key: 'provider', value: PROVIDER_LABELS[row.provider] ?? row.provider },
                                { key: 'token', value: row.site ? `${row.token} / ${row.site}` : row.token },
                                {
                                  key: 'open',
                                  value:
                                    row.openPostings === null
                                      ? t('boards.csv.previewUnknownRoles')
                                      : t('boards.csv.previewOpenRoles', { count: row.openPostings })
                                }
                              ]}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-[11px] text-text-faint">
                    {t('boards.csv.previewNote', { limit: format.number(shownPlan.capacity.limit) })}
                  </p>
                  <p className="text-[11px] text-text-faint">{t('boards.csv.unchecked')}</p>
                </>
              )}
            </section>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border-soft pt-3">
          <Button variant="ghost" onClick={handleClose} disabled={importing}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button
            onClick={handleImport}
            loading={importing}
            disabled={!loaded || !plan || plan.willImport === 0 || planning}
          >
            {t('boards.csv.import')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
