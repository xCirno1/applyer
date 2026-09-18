import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Callout from '../ui/Callout'
import Skeleton from '../ui/Skeleton'
import Tag from '../ui/Tag'
import TextField from '../ui/TextField'
import { useToast } from '../ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { appError, type AppError } from '@shared/types/errorCodes'
import { isOpenRouterModel, type OpenRouterModel } from '@shared/types/openrouter'
import { filterAndSortModels, formatContextLength, formatPricePerMillion } from './openRouterModelLogic'

/** callIpc's fallback for a rejected bridge call, same shape and reasoning as resumesStore's `BRIDGE_FAILURE`. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

type CatalogState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; models: OpenRouterModel[]; stale: boolean }

interface OpenRouterModelPickerProps {
  modelId: string
  onChange: (modelId: string) => void
  disabled?: boolean
  /**
   * Told the full `OpenRouterModel` for `modelId` whenever the catalog loads
   * or the selection changes (`null` while loading, on a load failure, or
   * when `modelId` isn't in the catalog). `OpenRouterModelSettings` uses
   * this to know which reasoning efforts the selected model supports,
   * without fetching the catalog a second time itself.
   */
  onSelectedModel?: (model: OpenRouterModel | null) => void
}

/**
 * Searchable model picker: a filter field over a fixed-height scrolling
 * list, per `Dropdown`'s own "wrapped by Select wherever a labeled field is
 * needed" doc comment not fitting here: a model row needs its id, price,
 * context length and a couple of tags, which `DropdownOption` (a bare
 * `{value, label}`) has no room for, so this is a purpose-built list
 * instead of a `Dropdown` wrapper.
 *
 * Every model coming back over IPC is re-validated with `isOpenRouterModel`
 * before it's rendered: this is OpenRouter's own catalog relayed through
 * main, not data this build controls the shape of.
 */
export default function OpenRouterModelPicker({
  modelId,
  onChange,
  disabled = false,
  onSelectedModel
}: OpenRouterModelPickerProps): ReactElement {
  const { t, i18n } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const locale = i18n.language

  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = async (refresh: boolean): Promise<void> => {
    if (refresh) setRefreshing(true)
    else setCatalog({ status: 'loading' })

    const result = await callIpc(
      'openrouter.listModels',
      () => window.api.openrouter.listModels({ refresh }),
      BRIDGE_FAILURE
    )

    if (refresh) setRefreshing(false)

    if (!result.ok) {
      if (!refresh) setCatalog({ status: 'error' })
      else toast.error(result.error ? errorMessage(result.error) : t('agent.models.refreshFailed'))
      return
    }

    const rawModels = Array.isArray(result.catalog?.models) ? result.catalog.models : []
    const models = rawModels.filter(isOpenRouterModel)
    if (models.length !== rawModels.length) {
      console.error('OpenRouter model catalog contained malformed entries; they were dropped.')
    }
    setCatalog({ status: 'ready', models, stale: result.catalog.stale === true })
  }

  useEffect(() => {
    // Standard fetch-on-mount: load's own setCatalog({status:'loading'}) runs
    // before its first await, which the lint rule reads as a synchronous
    // setState: intentional here, not a derived-state smell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedModel = catalog.status === 'ready' ? catalog.models.find((m) => m.id === modelId) ?? null : null

  useEffect(() => {
    // Only reported once the catalog has actually loaded: while it's still
    // loading (or failed), `selectedModel` is null for lack of data, not
    // because this model has no reasoning efforts, and a caller reconciling
    // a reasoning effort against "no efforts" must not treat those as the
    // same thing (see OpenRouterModelSettings's own effect).
    if (catalog.status === 'ready') onSelectedModel?.(selectedModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.status, selectedModel])

  if (catalog.status === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (catalog.status === 'error') {
    return (
      <Callout tone="danger">
        <div className="flex items-center justify-between gap-2">
          <span>{t('agent.models.loadFailed')}</span>
          <Button size="sm" onClick={() => void load(false)}>
            {t('actions.retry', { ns: 'common' })}
          </Button>
        </div>
      </Callout>
    )
  }

  const filtered = filterAndSortModels(catalog.models, query)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <TextField
            label={t('agent.models.searchLabel')}
            placeholder={t('agent.models.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
          />
        </div>
        <Button size="sm" onClick={() => void load(true)} loading={refreshing} disabled={disabled}>
          {t('agent.models.refresh')}
        </Button>
      </div>

      {catalog.stale && <p className="text-[11px] text-text-faint">{t('agent.models.staleNote')}</p>}

      {modelId !== '' && !selectedModel && (
        <Callout tone="warning">{t('agent.models.selectedMissing', { modelId })}</Callout>
      )}

      {catalog.models.length === 0 ? (
        <Callout tone="warning">{t('agent.models.empty')}</Callout>
      ) : filtered.length === 0 ? (
        <p className="border border-border-soft px-2.5 py-3 text-center text-[12px] text-text-faint">
          {t('agent.models.noMatches')}
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col overflow-y-auto border border-border-soft divide-y divide-border-soft">
          {filtered.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={model.id === modelId}
              disabled={disabled}
              locale={locale}
              onSelect={() => onChange(model.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ModelRow({
  model,
  selected,
  disabled,
  locale,
  onSelect
}: {
  model: OpenRouterModel
  selected: boolean
  disabled: boolean
  locale: string
  onSelect: () => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const promptPrice = formatPricePerMillion(model.promptPricePerMillion, locale)
  const completionPrice = formatPricePerMillion(model.completionPricePerMillion, locale)
  const context = formatContextLength(model.contextLength)

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={selected}
        className={`flex w-full flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          disabled ? '' : 'cursor-pointer hover:bg-canvas-soft'
        } ${selected ? 'bg-canvas-soft' : ''}`}
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-text">{model.name}</span>
          <span className="truncate font-mono text-[11px] text-text-faint">{model.id}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {model.isFree && <Tag tone="success" label={t('agent.models.freeTag')} />}
          {model.supportsReasoning && <Tag tone="neutral" label={t('agent.models.reasoningTag')} />}
          {context && <Tag tone="neutral" label={t('agent.models.contextTag', { ctx: context })} />}
          <span className="text-[11px] text-text-faint">
            {promptPrice && completionPrice
              ? t('agent.models.priceInOut', { in: promptPrice, out: completionPrice })
              : t('agent.models.priceVariable')}
          </span>
          {selected && <CheckIcon />}
        </span>
      </button>
    </li>
  )
}

function CheckIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-accent">
      <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
