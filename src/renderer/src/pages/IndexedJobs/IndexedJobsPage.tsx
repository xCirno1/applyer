import type { ReactElement } from 'react'
import IndexedJobsFilters from '../../components/indexedJobs/IndexedJobsFilters'
import IndexedJobsList from '../../components/indexedJobs/IndexedJobsList'

/**
 * Every job an agent's search has surfaced — matched (queued) and not —
 * so match quality can be audited rather than only seeing what made it
 * onto the board. See indexedJobsStore for the fetch/pagination/live-update
 * logic this page renders. No page-level header of its own — which screen
 * is showing is already indicated by the icon rail's active item, mirroring
 * how the editor area doesn't repeat itself below the top bar.
 */
export default function IndexedJobsPage(): ReactElement {
  return (
    <div className="flex h-full flex-col">
      <IndexedJobsFilters />
      <IndexedJobsList />
    </div>
  )
}
