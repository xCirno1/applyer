import { detectSource } from './sourceRouter'
import { fetchGreenhouseJobDetails } from './scrapers/greenhouse'
import { fetchLeverJobDetails } from './scrapers/lever'
import { fetchAshbyJobDetails } from './scrapers/ashby'
import { fetchIndeedJobDetails } from './scrapers/indeed'
import { fetchLinkedInJobDetails } from './scrapers/linkedin'
import { fetchWorkdayJobDetails } from './scrapers/workday'
import { fetchGenericJobDetails } from './scrapers/generic'
import type { JobDetailsOutcome } from './types'
import { isNavigableUrl } from '@shared/url'

export async function fetchJobDetails(url: string): Promise<JobDetailsOutcome> {
  // The same rule `getJobDetailsShape` already enforces, restated at the
  // point the navigation actually happens. Worth the duplication because of
  // what the default branch does: `detectSource` returns 'generic' for every
  // host it doesn't recognise, and the generic scraper is a bare
  // `page.goto(url)` — so anything that reaches here unchecked is fetched,
  // and `file:///…` is exactly the kind of URL no host pattern matches.
  if (!isNavigableUrl(url)) {
    return { status: 'not_found', message: 'Only http:// and https:// job URLs can be fetched.' }
  }

  const source = detectSource(url)
  switch (source) {
    case 'greenhouse':
      return fetchGreenhouseJobDetails(url)
    case 'lever':
      return fetchLeverJobDetails(url)
    case 'ashby':
      return fetchAshbyJobDetails(url)
    case 'indeed':
      return fetchIndeedJobDetails(url)
    case 'linkedin':
      return fetchLinkedInJobDetails(url)
    case 'workday':
      return fetchWorkdayJobDetails(url)
    case 'generic':
      return fetchGenericJobDetails(url)
  }
}
