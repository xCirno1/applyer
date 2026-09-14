import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useResumesStore } from '../../state/resumesStore'
import VariantsTab from './VariantsTab'
import MasterTab from './MasterTab'
import TemplatesTab from './TemplatesTab'
import { useResumesLayout } from './useResumesLayout'

export type ResumesTab = 'variants' | 'master' | 'templates'

const TAB_IDS: ResumesTab[] = ['variants', 'master', 'templates']

/**
 * The Resume Variants screen: three things the agent and the user share.
 * The master (the structured source), the templates (how any of it is laid
 * out), and the variants (named rewrites of the master that jobs point at,
 * what actually gets attached). Same shell as the Job Discovery screen: a
 * tab strip and mounted-but-hidden bodies, so switching tabs keeps an
 * in-progress edit.
 *
 * The job detail modal's "Open in Resume Variants" selects the job's
 * variant in the store *and* asks for the Variants tab (`requestedTab`),
 * since the user may have left this screen on another tab.
 */
export default function ResumesPage({ requestedTab }: { requestedTab: { tab: ResumesTab; nonce: number } | null }): ReactElement {
  const { t } = useTranslation('resumes')
  const [tab, setTab] = useState<ResumesTab>('variants')
  const [handledNonce, setHandledNonce] = useState(0)
  const loadedOnce = useResumesStore((s) => s.loadedOnce)
  const fetch = useResumesStore((s) => s.fetch)

  useEffect(() => {
    if (!loadedOnce) void fetch()
  }, [loadedOnce, fetch])

  // A request from another screen is applied while rendering rather than in
  // an effect: it is derived from props, and this way the first paint after
  // the switch already shows the right tab.
  if (requestedTab && requestedTab.nonce !== handledNonce) {
    setHandledNonce(requestedTab.nonce)
    setTab(requestedTab.tab)
  }

  // Column widths are shared by both document tabs so the details column
  // stays put when switching between them.
  const columns = useResumesLayout()

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
      </div>

      <div className={tab === 'variants' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <VariantsTab onGoToMaster={() => setTab('master')} columns={columns} />
      </div>
      <div className={tab === 'master' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <MasterTab columns={columns} />
      </div>
      <div className={tab === 'templates' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <TemplatesTab />
      </div>
    </div>
  )
}
