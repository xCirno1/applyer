import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import Tooltip from '../../components/ui/Tooltip'
import { useToast } from '../../components/ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { useFormatters } from '../../i18n/format'
import {
  AGGREGATOR_COVERAGE,
  AGGREGATOR_SOURCES,
  JOB_SOURCE_LABELS,
  SEARCH_COUNTRIES,
  aggregatorHost,
  aggregatorServesCountry,
  isSearchCountry,
  type SearchCountry
} from '@shared/types/jobSource'

/**
 * Settings > Job search: which country's edition of each job aggregator
 * `search_jobs` hits (see `@shared/types/jobSource` for why that is a
 * setting at all). Beneath the picker, the coverage table answers the
 * question the picker raises: "so which sites does a search from here
 * actually reach?", naming the hostname per site so a user who knows
 * `uk.indeed.com` from `www.indeed.com` can see which one they are getting.
 *
 * Saved on change, like the other single-field sections; the previous value
 * is restored on a failed save so the picker never shows a country the
 * main process did not accept.
 */
export default function SearchSection(): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const { country: countryName } = useFormatters()
  const [country, setCountry] = useState<SearchCountry | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void callIpc('settings.getSearchCountry', () => window.api.settings.getSearchCountry(), 'us').then(setCountry)
  }, [])

  const options = useMemo(
    () =>
      SEARCH_COUNTRIES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    [countryName]
  )

  const handleChange = async (value: string): Promise<void> => {
    if (!isSearchCountry(value) || country === null || value === country) return
    const previous = country
    setCountry(value)
    setSaving(true)
    const result = await callIpc(
      'settings.setSearchCountry',
      () => window.api.settings.setSearchCountry(value),
      { ok: false }
    )
    setSaving(false)
    if (result.ok) {
      toast.success(t('search.saved', { country: countryName(value) }))
    } else {
      setCountry(previous)
      toast.error(result.error ? errorMessage(result.error) : t('search.saveFailed'))
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{t('search.title')}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('search.intro')}</p>
      </div>

      {country === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <Select
            label={t('search.countryLabel')}
            options={options}
            value={country}
            onChange={(value) => void handleChange(value)}
            disabled={saving}
          />

          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-text-muted">
              {t('search.coverageTitle', { country: countryName(country) })}
            </span>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {AGGREGATOR_SOURCES.map((source) => {
                  const served = aggregatorServesCountry(source, country)
                  const host = aggregatorHost(source, country)
                  const global = AGGREGATOR_COVERAGE[source] === 'global'
                  return (
                    <tr key={source} className="border-b border-border-soft last:border-b-0">
                      <td className="py-1.5 pr-3 text-text">
                        <Tooltip label={t(`search.sources.${source}`)}>
                          <span className="cursor-help">{JOB_SOURCE_LABELS[source]}</span>
                        </Tooltip>
                      </td>
                      <td className={`py-1.5 text-right ${served ? 'text-text-muted' : 'text-text-faint'}`}>
                        {global ? t('search.worldwide') : host ? host : t('search.notAvailable')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-text-faint">{t('search.outro')}</p>
          </div>
        </>
      )}
    </div>
  )
}
