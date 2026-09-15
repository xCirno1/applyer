import { describe, it, expect } from 'vitest'
import {
  AGGREGATOR_SOURCES,
  JOB_SOURCES,
  JOB_SOURCE_LABELS,
  SEARCHABLE_SOURCES,
  SEARCH_COUNTRIES,
  DEFAULT_SEARCH_COUNTRY,
  aggregatorHost,
  aggregatorServesCountry,
  aggregatorsForCountry,
  isAggregatorSource,
  isJobSource,
  isSearchCountry
} from './jobSource'
import { ATS_PROVIDERS } from './companyBoard'

describe('job source lists', () => {
  it('lists every aggregator and ATS provider exactly once, with generic last', () => {
    expect(JOB_SOURCES).toEqual([...AGGREGATOR_SOURCES, ...ATS_PROVIDERS, 'generic'])
    expect(new Set(JOB_SOURCES).size).toBe(JOB_SOURCES.length)
  })

  it('keeps generic out of the searchable set', () => {
    expect(SEARCHABLE_SOURCES).not.toContain('generic')
    expect(SEARCHABLE_SOURCES).toEqual([...AGGREGATOR_SOURCES, ...ATS_PROVIDERS])
  })

  it('has a display label for every source but generic', () => {
    for (const source of JOB_SOURCES) {
      if (source === 'generic') continue
      expect(JOB_SOURCE_LABELS[source]).toEqual(expect.any(String))
    }
  })

  it('guards values', () => {
    expect(isJobSource('seek')).toBe(true)
    expect(isJobSource('generic')).toBe(true)
    expect(isJobSource('glassdoor')).toBe(false)
    expect(isJobSource(null)).toBe(false)
    expect(isAggregatorSource('jora')).toBe(true)
    expect(isAggregatorSource('greenhouse')).toBe(false)
  })
})

describe('search countries', () => {
  it('defaults to the edition the app always searched before the setting existed', () => {
    expect(DEFAULT_SEARCH_COUNTRY).toBe('us')
    expect(isSearchCountry(DEFAULT_SEARCH_COUNTRY)).toBe(true)
  })

  it('uses lowercase two-letter codes so Intl.DisplayNames can name them', () => {
    for (const country of SEARCH_COUNTRIES) {
      expect(country).toMatch(/^[a-z]{2}$/)
      expect(new Intl.DisplayNames(['en'], { type: 'region' }).of(country.toUpperCase())).not.toBe(
        country.toUpperCase()
      )
    }
  })

  it('rejects anything not in the list', () => {
    expect(isSearchCountry('US')).toBe(false)
    expect(isSearchCountry('xx')).toBe(false)
    expect(isSearchCountry(undefined)).toBe(false)
  })

  it('every country is served by at least one aggregator', () => {
    for (const country of SEARCH_COUNTRIES) {
      expect(aggregatorsForCountry(country).length).toBeGreaterThan(0)
    }
  })
})

describe('aggregator coverage', () => {
  it('maps a country to that edition of the site', () => {
    expect(aggregatorHost('indeed', 'us')).toBe('www.indeed.com')
    expect(aggregatorHost('indeed', 'gb')).toBe('uk.indeed.com')
    expect(aggregatorHost('indeed', 'au')).toBe('au.indeed.com')
    expect(aggregatorHost('seek', 'au')).toBe('au.seek.com')
    expect(aggregatorHost('seek', 'nz')).toBe('nz.seek.com')
    expect(aggregatorHost('jora', 'gb')).toBe('uk.jora.com')
    expect(aggregatorHost('prosple', 'id')).toBe('id.prosple.com')
  })

  it('returns null rather than a guessed hostname where there is no edition', () => {
    expect(aggregatorHost('seek', 'us')).toBeNull()
    expect(aggregatorHost('prosple', 'de')).toBeNull()
    expect(aggregatorServesCountry('seek', 'us')).toBe(false)
  })

  it('treats a worldwide site as serving every country with no host to pick', () => {
    for (const country of SEARCH_COUNTRIES) {
      expect(aggregatorServesCountry('linkedin', country)).toBe(true)
      expect(aggregatorServesCountry('remotive', country)).toBe(true)
    }
    expect(aggregatorHost('linkedin', 'au')).toBeNull()
  })

  it('lists the aggregators a country search will run, in registry order', () => {
    expect(aggregatorsForCountry('au')).toEqual(['indeed', 'linkedin', 'seek', 'jora', 'prosple', 'remotive'])
    expect(aggregatorsForCountry('us')).toEqual(['indeed', 'linkedin', 'jora', 'remotive'])
    expect(aggregatorsForCountry('de')).toEqual(['indeed', 'linkedin', 'jora', 'remotive'])
  })
})
