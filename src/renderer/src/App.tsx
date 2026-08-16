import { useEffect, useState, type ReactElement } from 'react'
import TerminalPane from './components/terminal/TerminalPane'
import BoardPage from './pages/Board/BoardPage'
import LogsPage from './pages/Logs/LogsPage'
import SettingsPage from './pages/Settings/SettingsPage'
import OnboardingFlow from './pages/Onboarding/OnboardingFlow'
import ToastProvider from './components/ui/ToastProvider'
import Skeleton from './components/ui/Skeleton'
import CaptchaAlertProvider from './providers/CaptchaAlertProvider'

const TABS = ['board', 'terminal', 'logs', 'settings'] as const
type Tab = (typeof TABS)[number]
type BootState = 'loading' | 'onboarding' | 'ready'

function MainShell(): ReactElement {
  const [tab, setTab] = useState<Tab>('board')

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <header className="flex h-nav shrink-0 items-center gap-1 border-b border-border bg-canvas px-3">
        <span className="text-[13px] font-medium text-text">JobHunt</span>
        <nav className="ml-4 flex h-full items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`h-7 cursor-pointer px-3 text-[12px] font-medium capitalize ${
                tab === t ? 'border-b-2 border-accent text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      <CaptchaAlertProvider>
        <main className="min-h-0 flex-1">
          {/* Board and Terminal stay mounted across tab switches — Board needs
              its live update subscription regardless of visibility, and
              Terminal's pty session would otherwise be killed. Logs/Settings
              mount fresh each visit instead, which is fine since they don't
              hold any state worth preserving. */}
          <div className={tab === 'board' ? 'h-full' : 'hidden'}>
            <BoardPage />
          </div>
          <div className={tab === 'terminal' ? 'h-full' : 'hidden'}>
            <div className="h-full bg-canvas-raised">
              <TerminalPane />
            </div>
          </div>
          {tab === 'logs' && <LogsPage />}
          {tab === 'settings' && <SettingsPage />}
        </main>
      </CaptchaAlertProvider>
    </div>
  )
}

export default function App(): ReactElement {
  const [boot, setBoot] = useState<BootState>('loading')

  useEffect(() => {
    window.api.onboarding.getStatus().then((status) => {
      setBoot(status.completed ? 'ready' : 'onboarding')
    })
  }, [])

  return (
    <ToastProvider>
      {boot === 'loading' && (
        <div className="flex h-full flex-col gap-2 bg-canvas-inset p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {boot === 'onboarding' && <OnboardingFlow onComplete={() => setBoot('ready')} />}
      {boot === 'ready' && <MainShell />}
    </ToastProvider>
  )
}
