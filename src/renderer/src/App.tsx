import { useState, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import logo from './assets/logo.png'
import WorkspacePage from './pages/Workspace/WorkspacePage'
import IndexedJobsPage from './pages/IndexedJobs/IndexedJobsPage'
import SettingsPage, { type SectionId } from './pages/Settings/SettingsPage'
import OnboardingFlow from './pages/Onboarding/OnboardingFlow'
import StorageRecoveryFlow from './pages/StorageRecovery/StorageRecoveryFlow'
import ToastProvider from './components/ui/ToastProvider'
import { useToast } from './components/ui/useToast'
import Skeleton from './components/ui/Skeleton'
import IconRail, { type RailPage } from './components/navigation/IconRail'
import JobDetailModal from './components/board/JobDetailModal'
import ExportModal from './pages/Settings/ExportModal'
import ImportModal from './pages/Settings/ImportModal'
import BrowserSetupModal from './components/browser/BrowserSetupModal'
import { useBrowserSetupState } from './components/browser/useBrowserSetupState'
import AppMenuBar from './components/workspace/AppMenuBar'
import DevBuildTag from './components/navigation/DevBuildTag'
import { useWorkspaceLayout } from './components/workspace/useWorkspaceLayout'
import CaptchaAlertProvider from './providers/CaptchaAlertProvider'
import ThemeProvider from './providers/ThemeProvider'
import LocaleProvider from './providers/LocaleProvider'
import ShortcutsProvider from './providers/ShortcutsProvider'
import { useShortcutHandler } from './providers/ShortcutsContext'
import { useJobsStore } from './state/jobsStore'
import { useProfileStore } from './state/profileStore'
import { useErrorMessage } from './i18n/formatError'
import type { StorageLocationStatus } from '@shared/types/storageLocation'
import type { AppError } from '@shared/types/errorCodes'

type Screen = RailPage | 'settings'
type BootState =
  | { phase: 'loading' }
  | { phase: 'storage-recovery'; status: StorageLocationStatus }
  | { phase: 'onboarding' }
  | { phase: 'ready' }

function MainShell(): ReactElement {
  const { t } = useTranslation('workspace')
  const [screen, setScreen] = useState<Screen>('workspace')
  const [settingsSection, setSettingsSection] = useState<SectionId>('profile')
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const activeJob = useJobsStore((s) => s.activeJob)
  const closeJob = useJobsStore((s) => s.closeJob)
  const browserSetup = useBrowserSetupState()
  const subscribeToProfileUpdates = useProfileStore((s) => s.subscribeToUpdates)
  useShortcutHandler('app.toggleSettings', () => setScreen((s) => (s === 'settings' ? 'workspace' : 'settings')))

  // Here rather than in the Settings profile form, which only exists while
  // that section is open — see profileStore's subscribeToUpdates.
  useEffect(() => subscribeToProfileUpdates(), [subscribeToProfileUpdates])

  // Owned here (not inside WorkspacePage) so the top bar it drives — logo,
  // menu, settings — can span the full window width, above the icon rail,
  // the same way VS Code's menu bar spans full width above its activity
  // bar rather than being indented past it.
  const { layout, setSidebarVisible, setDockVisible, setDockTab, setSidebarWidth, setDockHeight } =
    useWorkspaceLayout()

  const showTerminalTab = (): void => {
    setDockVisible(true)
    setDockTab('terminal')
  }

  useShortcutHandler('view.toggleOverview', () => setSidebarVisible(!layout.sidebarVisible))
  useShortcutHandler('view.toggleConsole', () => setDockVisible(!layout.dockVisible))
  useShortcutHandler('dock.showTerminal', showTerminalTab)
  useShortcutHandler('dock.showLogs', () => {
    setDockVisible(true)
    setDockTab('logs')
  })

  const openSettings = (section?: SectionId): void => {
    if (section) setSettingsSection(section)
    setScreen('settings')
  }

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <CaptchaAlertProvider>
        <main className="min-h-0 flex-1">
          {/* The workspace and Indexed Jobs screens stay mounted even while
              the other is showing (or Settings is open) — Workspace owns
              the terminal's live pty session and the jobs live-update
              subscription, and Indexed Jobs owns its own live-update
              subscription, both of which a remount would kill/drop. Toggled
              via `hidden` rather than conditional rendering for that reason.
              Settings mounts fresh each visit since it holds no state worth
              preserving. */}
          <div className={screen !== 'settings' ? 'flex h-full flex-col' : 'hidden'}>
            <header className="flex h-nav shrink-0 items-center gap-2 border-b border-border bg-canvas px-3">
              <img src={logo} alt="Applyer" className="h-5 w-5 shrink-0" draggable={false} />
              <AppMenuBar
                onOpenSettings={openSettings}
                onOpenExport={() => setExportOpen(true)}
                onOpenImport={() => setImportOpen(true)}
                sidebarVisible={layout.sidebarVisible}
                onToggleSidebar={() => setSidebarVisible(!layout.sidebarVisible)}
                dockVisible={layout.dockVisible}
                onToggleDock={() => setDockVisible(!layout.dockVisible)}
                onShowTerminalTab={showTerminalTab}
              />
              <div className="ml-auto flex items-center gap-1.5">
                <DevBuildTag />
                <button
                  onClick={() => openSettings()}
                  title={t('topBar.settings')}
                  aria-label={t('topBar.settings')}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center text-text-muted hover:text-text"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>
            </header>
            <div className="flex min-h-0 flex-1">
              <IconRail active={screen === 'settings' ? 'workspace' : screen} onSelect={setScreen} />
              <div className="min-h-0 min-w-0 flex-1">
                <div className={screen === 'workspace' ? 'h-full' : 'hidden'}>
                  <WorkspacePage
                    layout={layout}
                    setSidebarVisible={setSidebarVisible}
                    setDockVisible={setDockVisible}
                    setDockTab={setDockTab}
                    setSidebarWidth={setSidebarWidth}
                    setDockHeight={setDockHeight}
                  />
                </div>
                <div className={screen === 'indexedJobs' ? 'h-full' : 'hidden'}>
                  <IndexedJobsPage />
                </div>
              </div>
            </div>
          </div>
          {screen === 'settings' && (
            <div className="flex h-full flex-col">
              <div className="flex h-nav shrink-0 items-center border-b border-border bg-canvas px-3">
                <button
                  onClick={() => setScreen('workspace')}
                  className="cursor-pointer text-[12px] font-medium text-text-muted hover:text-text"
                >
                  {t('topBar.backToWorkspace')}
                </button>
                <div className="ml-auto flex items-center">
                  <DevBuildTag />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <SettingsPage
                  initialSection={settingsSection}
                  onOpenExport={() => setExportOpen(true)}
                  onOpenImport={() => setImportOpen(true)}
                />
              </div>
            </div>
          )}
        </main>
      </CaptchaAlertProvider>
      {/* Global — driven entirely by jobsStore's openJobId/activeJob, so any
          panel on any screen (board, sidebar, Indexed Jobs) can open it. */}
      <JobDetailModal job={activeJob} onClose={closeJob} />
      {/* Global too, for the same reason — the File menu pops these directly
          without navigating to Settings > Data first. */}
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <BrowserSetupModal
        state={browserSetup.state}
        dismissed={browserSetup.dismissed}
        onRetry={browserSetup.retry}
        onRespondInstall={browserSetup.respondInstall}
        onDismiss={browserSetup.dismiss}
      />
    </div>
  )
}

/**
 * Fires the storage location's one-shot startup warning (pointer file was
 * corrupt/unreadable — nothing concrete to retry, so it's a toast rather
 * than the blocking StorageRecoveryFlow) exactly once it arrives. Rendered
 * inside ToastProvider since App's boot check itself runs above that
 * provider in the tree and can't call useToast() directly — and App's own
 * getStatus() call is what consumes the warning server-side, so this
 * component only ever receives it via props, never fetches its own.
 */
function StartupWarningToast({ warning }: { warning: AppError | null }): null {
  const toast = useToast()
  const errorMessage = useErrorMessage()
  useEffect(() => {
    if (warning) toast.error(errorMessage(warning))
    // Fires once per distinct warning value — `toast` dispatches to a stable context value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warning])
  return null
}

export default function App(): ReactElement {
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' })
  const [startupWarning, setStartupWarning] = useState<AppError | null>(null)

  const checkBootState = (): void => {
    // Storage checked first and exclusively: onboarding.getStatus() reflects
    // whichever database happens to be open right now, which — while a
    // configured custom location is unavailable — is a substitute the app
    // booted into, not necessarily the user's real one. A fresh substitute
    // would claim `completed: false` even though the user finished
    // onboarding against their actual (currently unreachable) database, so
    // onboarding must not be checked until storage is resolved.
    window.api.storageLocation.getStatus().then((status) => {
      if (status.startupFallbackWarning) setStartupWarning(status.startupFallbackWarning)
      if (status.needsRecovery) {
        setBoot({ phase: 'storage-recovery', status })
        return
      }
      window.api.onboarding.getStatus().then((onboardingStatus) => {
        setBoot({ phase: onboardingStatus.completed ? 'ready' : 'onboarding' })
      })
    })
  }

  useEffect(checkBootState, [])

  return (
    <ShortcutsProvider>
      <LocaleProvider>
        <ThemeProvider>
          <ToastProvider>
            <StartupWarningToast warning={startupWarning} />
            {boot.phase === 'loading' && (
              <div className="flex h-full flex-col gap-2 bg-canvas-inset p-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-32 w-full" />
              </div>
            )}
            {boot.phase === 'storage-recovery' && (
              <StorageRecoveryFlow status={boot.status} onResolved={checkBootState} />
            )}
            {boot.phase === 'onboarding' && <OnboardingFlow onComplete={() => setBoot({ phase: 'ready' })} />}
            {boot.phase === 'ready' && <MainShell />}
          </ToastProvider>
        </ThemeProvider>
      </LocaleProvider>
    </ShortcutsProvider>
  )
}
