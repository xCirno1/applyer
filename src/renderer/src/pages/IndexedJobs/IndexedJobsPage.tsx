import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import IndexedJobsFilters from '../../components/indexedJobs/IndexedJobsFilters'
import IndexedJobsList from '../../components/indexedJobs/IndexedJobsList'
import IndexedJobsRetentionControl from '../../components/indexedJobs/IndexedJobsRetentionControl'
import ExclusionsPanel from '../../components/indexedJobs/ExclusionsPanel'
import CompanyBoardsPanel from '../../components/companyBoards/CompanyBoardsPanel'

type Tab = 'indexed' | 'boards' | 'excluded'

const TAB_IDS: Tab[] = ['indexed', 'boards', 'excluded']

/**
 * Every job an agent's search has surfaced — matched (queued) and not —
 * so match quality can be audited rather than only seeing what made it
 * onto the board, plus the two lists that shape what a search can surface at
 * all: "Company Boards" (the companies whose own ATS board is searched,
 * which for Greenhouse/Lever/Ashby/Workday *is* that source's entire
 * coverage) and "Excluded" (URLs kept out of results entirely). All three
 * tabs stay mounted (CSS visibility, same
 * reasoning as WorkspaceDock's Terminal/Activity Log tabs) so switching
 * back doesn't re-fetch or lose in-progress form state. No page-level
 * header beyond the tab strip — which screen is showing is already
 * indicated by the icon rail's active item, mirroring how the editor area
 * doesn't repeat itself below the top bar.
 */
export default function IndexedJobsPage(): ReactElement {
  const { t } = useTranslation('indexedJobs')
  const [tab, setTab] = useState<Tab>('indexed')

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-soft bg-canvas px-2">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-full cursor-pointer px-2.5 text-[12px] font-medium ${
              tab === id ? 'border-b-2 border-accent text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
        {tab === 'indexed' && <IndexedJobsRetentionControl className="ml-auto" />}
      </div>

      <div className={tab === 'indexed' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <IndexedJobsFilters />
        <IndexedJobsList />
      </div>
      <div className={tab === 'boards' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <CompanyBoardsPanel />
      </div>
      <div className={tab === 'excluded' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <ExclusionsPanel />
      </div>
    </div>
  )
}
