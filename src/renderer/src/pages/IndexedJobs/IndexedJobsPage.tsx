import { useState, type ReactElement } from 'react'
import IndexedJobsFilters from '../../components/indexedJobs/IndexedJobsFilters'
import IndexedJobsList from '../../components/indexedJobs/IndexedJobsList'
import IndexedJobsRetentionControl from '../../components/indexedJobs/IndexedJobsRetentionControl'
import ExclusionsPanel from '../../components/indexedJobs/ExclusionsPanel'

type Tab = 'indexed' | 'excluded'

const TABS: { id: Tab; label: string }[] = [
  { id: 'indexed', label: 'Indexed' },
  { id: 'excluded', label: 'Excluded' }
]

/**
 * Every job an agent's search has surfaced — matched (queued) and not —
 * so match quality can be audited rather than only seeing what made it
 * onto the board, plus (as the "Excluded" tab) the URLs that are kept out
 * of search results entirely. Both tabs stay mounted (CSS visibility, same
 * reasoning as WorkspaceDock's Terminal/Activity Log tabs) so switching
 * back doesn't re-fetch or lose in-progress form state. No page-level
 * header beyond the tab strip — which screen is showing is already
 * indicated by the icon rail's active item, mirroring how the editor area
 * doesn't repeat itself below the top bar.
 */
export default function IndexedJobsPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('indexed')

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-soft bg-canvas px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`h-full cursor-pointer px-2.5 text-[12px] font-medium ${
              tab === t.id ? 'border-b-2 border-accent text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
        {tab === 'indexed' && <IndexedJobsRetentionControl className="ml-auto" />}
      </div>

      <div className={tab === 'indexed' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <IndexedJobsFilters />
        <IndexedJobsList />
      </div>
      <div className={tab === 'excluded' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <ExclusionsPanel />
      </div>
    </div>
  )
}
