import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import { useToast } from '../ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useJobsStore } from '../../state/jobsStore'
import { describePayload, type HintAction, type HintCell, type HintTable, type PayloadSection } from './toolPayloadHints'
import { formatJson, readPayloadViewPreference, writePayloadViewPreference, type PayloadView, type ReadableEntry } from './toolPayloadRows'

/** Past this many characters the JSON view starts folded behind "Show all"; the readable view caps per list instead (`toolPayloadRows.ts`). */
const JSON_TRUNCATE_LENGTH = 4000
const COPIED_FEEDBACK_MS = 2000

/**
 * One section of a tool call's details (its arguments, or its result): a
 * title row with a Readable / JSON switch and a Copy button, then the
 * payload in that view. Readable is what `toolPayloadHints.ts` makes of
 * the tool's payload (a table of postings or form fields, an "open on the
 * board" action, labelled rows for the rest, or just the rows when the
 * tool is one it has no opinion on), the thing someone deciding whether
 * to approve "queue this job" actually wants to read; JSON is the raw text
 * for anyone checking exactly what the tool got, and is what Copy copies
 * whichever view is showing. Each section keeps its own choice, seeded
 * from the last one the user made anywhere, so a JSON-preferring user is
 * not switching every row. Used by `ToolCallCard` (both sections) and
 * `ToolApprovalCard` (arguments).
 */
export default function ToolPayloadView({
  title,
  toolName,
  section,
  raw,
  tone = 'default',
  maxHeightClass = 'max-h-56'
}: {
  title: string
  toolName: string
  section: PayloadSection
  raw: string | null
  tone?: 'default' | 'error'
  maxHeightClass?: string
}): ReactElement {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation()
  const [view, setView] = useState<PayloadView>(readPayloadViewPreference)
  const [showAll, setShowAll] = useState(false)
  const [copyResult, setCopyResult] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Same reasoning as `ui/CopyBlock`: the feedback timer can outlive a
  // fast unmount (the row closing right after a copy).
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const pick = (next: PayloadView): void => {
    setView(next)
    writePayloadViewPreference(next)
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatJson(raw))
      setCopyResult('copied')
    } catch (err) {
      console.error(`Could not copy the tool payload to the clipboard: ${String(err)}`)
      setCopyResult('failed')
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyResult('idle'), COPIED_FEEDBACK_MS)
  }

  const textTone = tone === 'error' ? 'text-danger' : 'text-text-muted'
  const hint = view === 'readable' ? describePayload(toolName, section, raw) : null
  const json = view === 'json' ? formatJson(raw) : ''
  const jsonFolded = json.length > JSON_TRUNCATE_LENGTH && !showAll
  const shownJson = jsonFolded ? `${json.slice(0, JSON_TRUNCATE_LENGTH)}…` : json
  const hasPayload = raw !== null && raw.trim().length > 0

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-5 items-center gap-1">
        <span className="text-[11px] font-medium text-text-faint">{title}</span>
        <div role="group" aria-label={t('toolCall.viewLabel', { section: title })} className="ml-auto flex">
          <HeaderButton active={view === 'readable'} onClick={() => pick('readable')} label={t('toolCall.viewReadable')} />
          <HeaderButton active={view === 'json'} onClick={() => pick('json')} label={t('toolCall.viewJson')} />
        </div>
        <HeaderButton
          onClick={() => void copy()}
          disabled={!hasPayload}
          danger={copyResult === 'failed'}
          label={copyResult === 'copied' ? tCommon('actions.copied') : copyResult === 'failed' ? tCommon('actions.copyFailed') : tCommon('actions.copy')}
        />
      </div>

      {hint &&
        (hint.table || hint.rows || hint.actions.length > 0 ? (
          <div className={`${maxHeightClass} flex flex-col gap-1 overflow-auto`}>
            {hint.table && <HintTableView table={hint.table} tone={textTone} />}
            {hint.rows && <ReadableRows entries={hint.rows} tone={textTone} />}
            {hint.actions.length > 0 && <HintActions actions={hint.actions} />}
          </div>
        ) : (
          <span className="text-[11px] text-text-faint">{t('payload.nothing')}</span>
        ))}

      {view === 'json' && (
        <>
          <pre className={`${maxHeightClass} overflow-auto whitespace-pre-wrap text-[11px] ${textTone}`}>{shownJson}</pre>
          {json.length > JSON_TRUNCATE_LENGTH && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t('toolCall.showLess') : t('toolCall.showAll')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function HeaderButton({
  active,
  disabled,
  danger,
  onClick,
  label
}: {
  active?: boolean
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  label: string
}): ReactElement {
  const toneClass = active
    ? 'z-10 border-accent text-accent'
    : danger
      ? 'border-border text-danger'
      : 'border-border text-text-faint hover:border-text-faint hover:text-text'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`h-5 cursor-pointer border px-1.5 text-[10px] leading-none -ml-px first:ml-0 disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {label}
    </button>
  )
}

/** Opens a tracked job in the board's detail modal, or says it is gone (a job the agent listed can have been deleted since). */
function useOpenJob(): (jobId: string) => Promise<void> {
  const { t } = useTranslation('chat')
  const toast = useToast()
  const openJob = useJobsStore((s) => s.openJob)
  return async (jobId) => {
    const { job } = await callIpc(`jobs.get(${jobId})`, () => window.api.jobs.get(jobId), { job: null })
    if (!job) {
      toast.error(t('payload.jobGone'))
      return
    }
    openJob(jobId)
  }
}

function JobLink({ jobId, text }: { jobId: string; text: string }): ReactElement {
  const open = useOpenJob()
  return (
    <button type="button" onClick={() => void open(jobId)} className="cursor-pointer text-left text-accent underline hover:opacity-80">
      {text}
    </button>
  )
}

/** Same as `MarkdownView`'s links: a `target="_blank"` anchor goes through main's window-open handler to the OS browser. */
function ExternalLink({ url, text }: { url: string; text: string }): ReactElement {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-accent underline hover:opacity-80">
      {text}
    </a>
  )
}

function HintCellView({ cell, tone }: { cell: HintCell; tone: string }): ReactElement {
  const { t } = useTranslation('chat')
  switch (cell.kind) {
    case 'url':
      return <ExternalLink url={cell.url} text={cell.text} />
    case 'job':
      return <JobLink jobId={cell.jobId} text={cell.text} />
    case 'bool':
      return <span className={tone}>{cell.value ? t('payload.yes') : t('payload.no')}</span>
    default:
      if (cell.text.length === 0) return <span className="text-text-faint">{t('payload.none')}</span>
      return <span className={cell.tone === 'danger' ? 'text-danger' : cell.tone === 'muted' ? 'text-text-faint' : tone}>{cell.text}</span>
  }
}

function HintTableView({ table, tone }: { table: HintTable; tone: string }): ReactElement {
  const { t } = useTranslation('chat')
  return (
    <div className="flex flex-col gap-0.5">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border-soft">
              {table.columns.map((column) => (
                <th key={column} scope="col" className="py-0.5 pr-2 text-left font-medium text-text-faint">
                  {t(`payload.column.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border-soft last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="max-w-56 truncate py-0.5 pr-2 align-top">
                    <HintCellView cell={cell} tone={tone} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length === 0 && <span className="text-[11px] text-text-faint">{t('payload.noRows')}</span>}
      {table.hiddenCount > 0 && <span className="text-[11px] text-text-faint">{t('payload.more', { count: table.hiddenCount })}</span>}
    </div>
  )
}

function HintActions({ actions }: { actions: HintAction[] }): ReactElement {
  const { t } = useTranslation('chat')
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {actions.map((action) =>
        action.kind === 'openJob' ? (
          <JobLink key={`job:${action.jobId}`} jobId={action.jobId} text={t('payload.openJob')} />
        ) : (
          <ExternalLink key={`url:${action.url}`} url={action.url} text={t('payload.openPosting')} />
        )
      )}
    </div>
  )
}

function ReadableRows({ entries, tone }: { entries: ReadableEntry[]; tone: string }): ReactElement {
  return (
    <dl className="flex flex-col gap-0.5">
      {entries.map((entry, index) => (
        <ReadableRow key={index} entry={entry} tone={tone} />
      ))}
    </dl>
  )
}

function ReadableRow({ entry, tone }: { entry: ReadableEntry; tone: string }): ReactElement {
  const { t } = useTranslation('chat')
  if (entry.type === 'more') {
    return <dd className="text-[11px] text-text-faint">{t('payload.more', { count: entry.count })}</dd>
  }

  const label = entry.label !== null && <dt className="shrink-0 text-[11px] text-text-faint">{entry.label}</dt>

  if (entry.type === 'group') {
    return (
      <div className="flex flex-col gap-0.5">
        {label}
        <dd className="ml-1 border-l border-border-soft pl-2">
          <ReadableRows entries={entry.items} tone={tone} />
        </dd>
      </div>
    )
  }

  if (entry.type === 'text' && entry.long) {
    return (
      <div className="flex flex-col gap-0.5">
        {label}
        <dd className={`max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] ${tone}`}>{entry.text}</dd>
      </div>
    )
  }

  const value =
    entry.type === 'boolean' ? (
      <span className={tone}>{entry.value ? t('payload.yes') : t('payload.no')}</span>
    ) : entry.type === 'empty' ? (
      <span className="text-text-faint">{t('payload.none')}</span>
    ) : (
      <span className={`break-words ${tone}`}>{entry.text}</span>
    )

  return (
    <div className="flex items-baseline gap-1.5 text-[11px]">
      {label}
      <dd className="min-w-0">{value}</dd>
    </div>
  )
}
