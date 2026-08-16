import { detectSource } from './sourceRouter'
import { fetchGreenhouseJobDetails } from './scrapers/greenhouse'
import { fetchLeverJobDetails } from './scrapers/lever'
import { fetchAshbyJobDetails } from './scrapers/ashby'
import { fetchIndeedJobDetails } from './scrapers/indeed'
import { fetchLinkedInJobDetails } from './scrapers/linkedin'
import { fetchWorkdayJobDetails } from './scrapers/workday'
import { fetchGenericJobDetails } from './scrapers/generic'
import type { JobDetailsOutcome } from './types'

export async function fetchJobDetails(url: string): Promise<JobDetailsOutcome> {
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
