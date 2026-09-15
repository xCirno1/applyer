import { ATS_PROVIDERS, type AtsProvider } from './companyBoard'

/**
 * Where a job posting came from, and which of those places a keyword search
 * can reach.
 *
 * Two families. An *aggregator* is a site with its own cross-company search
 * box (Indeed, Seek, Jora, Prosple, LinkedIn, Remotive), which `search_jobs`
 * drives directly. An *ATS provider* (Greenhouse, Lever, Ashby, Workday) only
 * serves one company's board at a time, so "searching" one means fetching the
 * boards on the user's watchlist (see `companyBoard.ts`). `generic` is the
 * fallback `detectSource` returns for any other career page: it can be read
 * with `get_job_details` but has nothing to enumerate.
 *
 * Both the main process (routing, the MCP schema) and the renderer (the two
 * source dropdowns, the source label on a row) read this list, so it lives in
 * `shared/` rather than next to the scrapers. Adding a source is: one entry
 * here, one scraper module, one adapter in `main/browser/aggregators.ts`, one
 * case in `main/browser/jobDetails.ts`, and a hostname rule in
 * `main/browser/sourceRouter.ts`.
 */
export const AGGREGATOR_SOURCES = ['indeed', 'linkedin', 'seek', 'jora', 'prosple', 'remotive'] as const

export type AggregatorSource = (typeof AGGREGATOR_SOURCES)[number]

export const JOB_SOURCES = [...AGGREGATOR_SOURCES, ...ATS_PROVIDERS, 'generic'] as const

export type JobSource = AggregatorSource | AtsProvider | 'generic'

/**
 * Every source the search tool accepts. `generic` stays out: it is the
 * fallback for an arbitrary careers page and has nothing to enumerate, so
 * `get_job_details` on a specific URL is the only thing that makes sense for
 * it.
 */
export const SEARCHABLE_SOURCES: readonly JobSource[] = [...AGGREGATOR_SOURCES, ...ATS_PROVIDERS]

export function isJobSource(value: unknown): value is JobSource {
  return typeof value === 'string' && (JOB_SOURCES as readonly string[]).includes(value)
}

export function isAggregatorSource(value: unknown): value is AggregatorSource {
  return typeof value === 'string' && (AGGREGATOR_SOURCES as readonly string[]).includes(value)
}

/** Display names. Job-board brands are proper nouns and stay untranslated; `generic` gets a translated label from the caller. */
export const JOB_SOURCE_LABELS: Record<Exclude<JobSource, 'generic'>, string> = {
  indeed: 'Indeed',
  linkedin: 'LinkedIn',
  seek: 'Seek',
  jora: 'Jora',
  prosple: 'Prosple',
  remotive: 'Remotive',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday'
}

/**
 * Which country's edition of each aggregator a search should hit.
 *
 * Most aggregators are not one site but a family of national ones, each with
 * its own hostname and its own index: `au.indeed.com` does not know about a
 * job posted to `www.indeed.com`, and Seek does not exist outside Australia
 * and New Zealand at all. A search that always hit the US edition (which is
 * what the app did before this setting existed) was silently useless for
 * anyone outside it, so the edition is a setting, with a per-call override
 * on `search_jobs` for "look in New Zealand this time".
 *
 * ISO 3166-1 alpha-2, lowercased, so `Intl.DisplayNames` can name them in the
 * user's language without a catalog entry per country. The list is the set of
 * countries at least one aggregator here has an edition for; it is not meant
 * to be every country, and adding one is a matter of filling in the host
 * tables below.
 */
export const SEARCH_COUNTRIES = [
  'us',
  'ca',
  'gb',
  'ie',
  'au',
  'nz',
  'sg',
  'my',
  'ph',
  'id',
  'in',
  'hk',
  'ae',
  'za',
  'de',
  'fr',
  'nl'
] as const

export type SearchCountry = (typeof SEARCH_COUNTRIES)[number]

/** The edition the app searched before the setting existed, so an unset preference changes nothing. */
export const DEFAULT_SEARCH_COUNTRY: SearchCountry = 'us'

export function isSearchCountry(value: unknown): value is SearchCountry {
  return typeof value === 'string' && (SEARCH_COUNTRIES as readonly string[]).includes(value)
}

/**
 * Hostname of each aggregator's edition per country, or absent where the
 * aggregator has no edition there. Written out in full rather than as a
 * `${country}.site.com` rule so that an edition that does not exist is a
 * missing row here, not a request to a hostname that resolves to nothing (or
 * to a redirect to the US site, which is worse: it answers, with the wrong
 * country's jobs).
 */
const INDEED_HOSTS: Partial<Record<SearchCountry, string>> = {
  us: 'www.indeed.com',
  ca: 'ca.indeed.com',
  gb: 'uk.indeed.com',
  ie: 'ie.indeed.com',
  au: 'au.indeed.com',
  nz: 'nz.indeed.com',
  sg: 'sg.indeed.com',
  my: 'malaysia.indeed.com',
  ph: 'ph.indeed.com',
  id: 'id.indeed.com',
  in: 'in.indeed.com',
  hk: 'hk.indeed.com',
  ae: 'ae.indeed.com',
  za: 'za.indeed.com',
  de: 'de.indeed.com',
  fr: 'fr.indeed.com',
  nl: 'nl.indeed.com'
}

/** Seek moved from `seek.com.au` / `seek.co.nz` to country subdomains of `seek.com`; the old hosts redirect. */
const SEEK_HOSTS: Partial<Record<SearchCountry, string>> = {
  au: 'au.seek.com',
  nz: 'nz.seek.com'
}

const JORA_HOSTS: Partial<Record<SearchCountry, string>> = {
  us: 'us.jora.com',
  ca: 'ca.jora.com',
  gb: 'uk.jora.com',
  ie: 'ie.jora.com',
  au: 'au.jora.com',
  nz: 'nz.jora.com',
  sg: 'sg.jora.com',
  my: 'my.jora.com',
  ph: 'ph.jora.com',
  id: 'id.jora.com',
  in: 'in.jora.com',
  hk: 'hk.jora.com',
  ae: 'ae.jora.com',
  za: 'za.jora.com',
  de: 'de.jora.com',
  fr: 'fr.jora.com',
  nl: 'nl.jora.com'
}

const PROSPLE_HOSTS: Partial<Record<SearchCountry, string>> = {
  au: 'au.prosple.com',
  nz: 'nz.prosple.com',
  sg: 'sg.prosple.com',
  my: 'my.prosple.com',
  ph: 'ph.prosple.com',
  id: 'id.prosple.com',
  in: 'in.prosple.com',
  hk: 'hk.prosple.com'
}

/**
 * `'global'` marks an aggregator with one worldwide site, where the country
 * setting has nothing to choose between: LinkedIn narrows by the `location`
 * argument instead, and Remotive lists remote-only roles with no country at
 * all.
 */
export const AGGREGATOR_COVERAGE: Record<AggregatorSource, Partial<Record<SearchCountry, string>> | 'global'> = {
  indeed: INDEED_HOSTS,
  linkedin: 'global',
  seek: SEEK_HOSTS,
  jora: JORA_HOSTS,
  prosple: PROSPLE_HOSTS,
  remotive: 'global'
}

/** The hostname to search for `source` in `country`, or null when that aggregator has no edition there. */
export function aggregatorHost(source: AggregatorSource, country: SearchCountry): string | null {
  const coverage = AGGREGATOR_COVERAGE[source]
  if (coverage === 'global') return null
  return coverage[country] ?? null
}

/** True when a search for `source` in `country` has somewhere to go. */
export function aggregatorServesCountry(source: AggregatorSource, country: SearchCountry): boolean {
  return AGGREGATOR_COVERAGE[source] === 'global' || aggregatorHost(source, country) !== null
}

/** The aggregators a search in `country` will actually run, in registry order. */
export function aggregatorsForCountry(country: SearchCountry): AggregatorSource[] {
  return AGGREGATOR_SOURCES.filter((source) => aggregatorServesCountry(source, country))
}
