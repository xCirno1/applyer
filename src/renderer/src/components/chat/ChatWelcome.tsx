import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import logo from '../../assets/logo.png'

/**
 * What an empty session shows instead of a blank thread: the agent's name,
 * one sentence on what it can do, and three starter requests that drop
 * into the composer on click (into, not sent: the user still reads and
 * presses Enter, same contract as every other "send to agent" button in
 * the app). Starters are fixed sentences rather than
 * `pages/Onboarding/firstPrompt.ts`'s profile-aware pick, since that one
 * is about the very first thing to say on a fresh install and this shows
 * on every new chat.
 */
export default function ChatWelcome({ onPick }: { onPick: (text: string) => void }): ReactElement {
  const { t } = useTranslation('chat')
  const starters = [t('welcome.starterFindJobs'), t('welcome.starterFillProfile'), t('welcome.starterTailor')]

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6 text-center">
      <div className="flex flex-col items-center gap-1.5">
        <img src={logo} alt="" className="h-7 w-7" draggable={false} />
        <span className="text-[13px] font-medium text-text">{t('welcome.title')}</span>
        <p className="max-w-xs text-[12px] text-text-muted">{t('welcome.subtitle')}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col items-stretch gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint">{t('welcome.startersHeading')}</span>
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className="h-7 cursor-pointer truncate border border-border-soft px-2 text-left text-[12px] text-text-muted hover:border-border hover:bg-canvas-soft hover:text-text"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  )
}
