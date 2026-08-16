import { useEffect, useState, type ReactElement } from 'react'
import WorkspacePage from './pages/Workspace/WorkspacePage'
import SettingsPage from './pages/Settings/SettingsPage'
import OnboardingFlow from './pages/Onboarding/OnboardingFlow'
import ToastProvider from './components/ui/ToastProvider'
import Skeleton from './components/ui/Skeleton'
import CaptchaAlertProvider from './providers/CaptchaAlertProvider'

type Screen = 'workspace' | 'settings'
type BootState = 'loading' | 'onboarding' | 'ready'

function MainShell(): ReactElement {
  const [screen, setScreen] = useState<Screen>('workspace')

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <CaptchaAlertProvider>
        <main className="min-h-0 flex-1">
          {/* The workspace stays mounted even while Settings is open — it
              owns the terminal's live pty session and the jobs live-update
              subscription, both of which a remount would kill/drop. Settings
              mounts fresh each visit since it holds no state worth
              preserving. */}
          <div className={screen === 'workspace' ? 'h-full' : 'hidden'}>
            <WorkspacePage onOpenSettings={() => setScreen('settings')} />
          </div>
          {screen === 'settings' && (
            <div className="flex h-full flex-col">
              <div className="flex h-nav shrink-0 items-center border-b border-border bg-canvas px-3">
                <button
                  onClick={() => setScreen('workspace')}
                  className="cursor-pointer text-[12px] font-medium text-text-muted hover:text-text"
                >
                  ← Back to workspace
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <SettingsPage />
              </div>
            </div>
          )}
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
