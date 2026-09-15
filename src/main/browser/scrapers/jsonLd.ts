/**
 * Reading a job posting out of a page's schema.org markup.
 *
 * Seek, Jora, Prosple, Indeed and most other boards embed a
 * `<script type="application/ld+json">` describing the posting as a
 * schema.org `JobPosting`, because that is what Google for Jobs indexes.
 * Unlike class names, that markup is a published contract the site has a
 * commercial reason to keep valid, so it is the first thing the detail
 * scrapers read and the CSS selectors are only the fallback for a page that
 * has none.
 *
 * Everything here is defensive by construction: the JSON is whatever the site
 * served, so every field is checked for its type and a value of the wrong
 * shape is dropped rather than trusted. Nothing throws.
 */

export interface JobPostingLd {
  title: string | null
  company: string | null
  /** "Sydney NSW, Australia"; joined from the first jobLocation's postal address. */
  location: string | null
  /** The description as served: HTML on most sites, occasionally plain text. */
  descriptionHtml: string | null
  datePosted: string | null
  /** "AUD 120000-140000 / YEAR", or the raw value when it is a string. */
  salary: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function typeOf(node: Record<string, unknown>): string[] {
  const raw = node['@type']
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  return []
}

/**
 * Walks every node a block can hold: a bare object, an array of them, or a
 * `@graph` wrapper, each of which is something a real site serves.
 */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item)
    return
  }
  if (!isRecord(value)) return
  yield value
  if (Array.isArray(value['@graph'])) yield* nodes(value['@graph'])
}

/** "Name" from either a plain string or a `{ name }` object, both of which schema.org allows. */
function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return nonEmptyString(value)
  if (isRecord(value)) return nonEmptyString(value.name)
  return null
}

function locationOf(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  if (!isRecord(first)) return null
  const address = isRecord(first.address) ? first.address : first
  const parts = [
    nonEmptyString(address.addressLocality),
    nonEmptyString(address.addressRegion),
    nameOf(address.addressCountry)
  ].filter((part): part is string => part !== null)
  if (parts.length > 0) return parts.join(', ')
  return nonEmptyString(first.name)
}

function salaryOf(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return nonEmptyString(String(value))
  if (!isRecord(value)) return null
  const currency = nonEmptyString(value.currency)
  const amount = isRecord(value.value) ? value.value : value
  const min = typeof amount.minValue === 'number' ? amount.minValue : null
  const max = typeof amount.maxValue === 'number' ? amount.maxValue : null
  const single = typeof amount.value === 'number' ? amount.value : null
  const unit = nonEmptyString(amount.unitText)
  let range: string | null = null
  if (min !== null && max !== null) range = min === max ? String(min) : `${min}-${max}`
  else if (min !== null) range = `${min}+`
  else if (max !== null) range = `up to ${max}`
  else if (single !== null) range = String(single)
  if (range === null) return null
  return [currency, range, unit ? `/ ${unit}` : null].filter((part) => part !== null).join(' ')
}

/**
 * The first `JobPosting` found across the given script bodies, or null when
 * there is none. A block that is not valid JSON is skipped: sites do ship
 * broken blocks, and one of those must not hide a good one after it.
 */
export function parseJobPostingLd(scripts: readonly string[]): JobPostingLd | null {
  for (const script of scripts) {
    let parsed: unknown
    try {
      parsed = JSON.parse(script)
    } catch {
      continue
    }
    for (const node of nodes(parsed)) {
      if (!typeOf(node).includes('JobPosting')) continue
      return {
        title: nonEmptyString(node.title) ?? nonEmptyString(node.name),
        company: nameOf(node.hiringOrganization),
        location: locationOf(node.jobLocation),
        descriptionHtml: nonEmptyString(node.description),
        datePosted: nonEmptyString(node.datePosted),
        salary: salaryOf(node.baseSalary)
      }
    }
  }
  return null
}
