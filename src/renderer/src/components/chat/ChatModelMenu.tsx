import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSession } from '@shared/types/chat'
import {
  isOpenRouterModel,
  isReasoningEffort,
  type OpenRouterModel,
  type OpenRouterSettings,
  type ReasoningEffort
} from '@shared/types/openrouter'
import { appError, type AppError } from '@shared/types/errorCodes'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { useToast } from '../ui/useToast'
import Dropdown from '../ui/Dropdown'
import Skeleton from '../ui/Skeleton'
import Spinner from '../ui/Spinner'
import Tooltip from '../ui/Tooltip'
import { useChatStore } from '../../state/chatStore'
import { formatContextLength, formatPricePerMillion, selectableReasoningEfforts } from '../settings/openRouterModelLogic'
import { modelMatches, shortModelName } from './chatPanelLogic'

type CatalogState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; models: OpenRouterModel[] }

/** callIpc's fallback for a rejected bridge call, same shape and reasoning as `OpenRouterModelPicker`'s. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

/**
 * The composer footer's model control: a button naming the session's
 * model (and the reasoning effort in force), opening a popover with a
 * search field over OpenRouter's tool-capable catalog and an effort
 * picker. Picking a model re-pins *this session* (`chat.setSessionModel`),
 * since each session carries its own model (see `agentRunner.ts`); the
 * reasoning effort is the one global OpenRouter setting, the same value
 * Settings > Agent edits. The full picker with prices, tags and a refresh
 * button stays in Settings; this is the quick switch a sidebar chat
 * offers next to its input, capped to one page of matches
 * (`modelMatches`) so it opens instantly on a catalog of hundreds.
 */
export default function ChatModelMenu({ session, disabled }: { session: ChatSession | null; disabled: boolean }): ReactElement {
  const { t, i18n } = useTranslation('chat')
  const { t: tSettings } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const setSessionModel = useChatStore((s) => s.setSessionModel)
  const acting = useChatStore((s) => (session ? Boolean(s.actingSessionIds[session.id]) : false))

  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [settings, setSettings] = useState<OpenRouterSettings | null>(null)
  const [savingEffort, setSavingEffort] = useState(false)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Fetched on each open rather than once: the catalog is served from
  // main's own disk cache, so this is cheap, and it picks up a refresh
  // done in Settings meanwhile. Settings likewise, so an effort changed
  // there shows here.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const [models, current] = await Promise.all([
        callIpc('openrouter.listModels', () => window.api.openrouter.listModels(), BRIDGE_FAILURE),
        callIpc('openrouter.getSettings', () => window.api.openrouter.getSettings(), null)
      ])
      if (cancelled) return
      if (models.ok) {
        const valid = models.catalog.models.filter((model) => {
          if (isOpenRouterModel(model)) return true
          console.warn('Ignored malformed OpenRouter model', model)
          return false
        })
        setCatalog({ status: 'ready', models: valid })
      } else {
        setCatalog((existing) => (existing.status === 'ready' ? existing : { status: 'error' }))
      }
      if (current && isReasoningEffort(current.reasoningEffort)) setSettings(current)
    })()
    searchRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [open])

  const currentModel = catalog.status === 'ready' && session ? catalog.models.find((m) => m.id === session.modelId) ?? null : null
  const efforts = selectableReasoningEfforts(currentModel?.reasoningEfforts)
  const effort: ReasoningEffort = settings?.reasoningEffort ?? 'default'

  const pickModel = async (modelId: string): Promise<void> => {
    if (!session || modelId === session.modelId) {
      setOpen(false)
      return
    }
    const result = await setSessionModel(session.id, modelId)
    if (result.ok) {
      toast.success(t('model.changed', { model: shortModelName(modelId) }))
      setOpen(false)
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('model.changeFailed'))
    }
  }

  const pickEffort = async (value: string): Promise<void> => {
    if (!settings || !isReasoningEffort(value) || value === settings.reasoningEffort) return
    setSavingEffort(true)
    const next = { ...settings, reasoningEffort: value }
    const result = await callIpc('openrouter.setSettings', () => window.api.openrouter.setSettings(next), BRIDGE_FAILURE)
    setSavingEffort(false)
    if (result.ok) {
      setSettings(result.settings)
      toast.success(t('model.effortSaved', { effort: tSettings(`agent.models.effort.${value}`) }))
    } else {
      toast.error(t('model.effortFailed'))
    }
  }

  const matches = catalog.status === 'ready' ? modelMatches(catalog.models, query) : null
  const effortSuffix = effort === 'default' ? '' : ` · ${tSettings(`agent.models.effort.${effort}`)}`
  const label = session ? `${shortModelName(session.modelId)}${effortSuffix}` : t('model.label')

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Tooltip label={session ? `${t('model.change')}: ${session.modelId}` : t('model.label')}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || !session}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex h-5 max-w-56 cursor-pointer items-center gap-1 px-1 text-[11px] text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          {acting ? <Spinner className="h-3 w-3" /> : <ModelIcon />}
          <span className="truncate">{label}</span>
          <ChevronIcon />
        </button>
      </Tooltip>

      {open && (
        <div
          role="dialog"
          aria-label={t('model.change')}
          className="absolute bottom-full left-0 z-20 mb-1 flex w-72 flex-col border border-border bg-canvas-raised shadow-pop"
        >
          <div className="border-b border-border-soft p-1.5">
            <input
              ref={searchRef}
              type="search"
              aria-label={t('model.searchLabel')}
              placeholder={t('model.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-6 w-full border border-border bg-canvas-soft px-1.5 text-[12px] text-text outline-none placeholder:text-text-faint focus:border-accent"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {catalog.status === 'loading' && (
              <div className="flex flex-col gap-1 p-1.5">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            )}
            {catalog.status === 'error' && <p className="p-3 text-[12px] text-danger">{t('model.loadFailed')}</p>}
            {matches && matches.shown.length === 0 && <p className="p-3 text-[12px] text-text-faint">{t('model.noMatches')}</p>}
            {matches && matches.shown.length > 0 && (
              <ul role="listbox" aria-label={t('model.label')}>
                {matches.shown.map((model) => {
                  const selected = session?.modelId === model.id
                  const price = formatPricePerMillion(model.promptPricePerMillion, i18n.language)
                  const ctx = formatContextLength(model.contextLength)
                  return (
                    <li key={model.id} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        onClick={() => void pickModel(model.id)}
                        className={`flex w-full cursor-pointer flex-col gap-0 border-l-2 px-2 py-1 text-left hover:bg-canvas-soft ${
                          selected ? 'border-accent bg-canvas-soft' : 'border-transparent'
                        }`}
                      >
                        <span className="truncate text-[12px] text-text">{model.name}</span>
                        <span className="flex items-center gap-1.5 truncate text-[11px] text-text-faint">
                          <span className="truncate">{model.id}</span>
                          {model.isFree ? (
                            <span className="shrink-0 text-success">{t('model.free')}</span>
                          ) : (
                            price && <span className="shrink-0">{price}</span>
                          )}
                          {ctx && <span className="shrink-0">{tSettings('agent.models.contextTag', { ctx })}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {matches && matches.hiddenCount > 0 && (
              <p className="border-t border-border-soft px-2 py-1 text-[11px] text-text-faint">
                {t('model.moreMatches', { count: matches.hiddenCount })}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border-soft px-2 py-1.5">
            <span className="shrink-0 text-[11px] text-text-muted">{t('model.effort')}</span>
            {settings ? (
              efforts.length > 1 ? (
                <Dropdown
                  size="sm"
                  ariaLabel={t('model.effort')}
                  value={efforts.includes(effort) ? effort : 'default'}
                  disabled={savingEffort}
                  onChange={(value) => void pickEffort(value)}
                  options={efforts.map((value) => ({ value, label: tSettings(`agent.models.effort.${value}`) }))}
                  className="min-w-0 flex-1"
                />
              ) : (
                <span className="truncate text-[11px] text-text-faint">{t('model.effortUnsupported')}</span>
              )
            ) : (
              <Skeleton className="h-6 flex-1" />
            )}
            {savingEffort && <Spinner className="h-3 w-3 shrink-0" />}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="1.5" y="3" width="9" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 6h.01M8 6h.01M6 1.5v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon(): ReactElement {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M2 6.5l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
