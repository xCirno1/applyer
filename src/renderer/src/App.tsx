import { useState, useEffect, type ReactElement, type ReactNode } from 'react'
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
import Button from './components/ui/Button'
import Callout from './components/ui/Callout'
import ErrorBoundary from './components/ui/ErrorBoundary'
import IconRail, { type RailPage } from './components/navigation/IconRail'
import JobDetailModal from './components/board/JobDetailModal'
import ExportModal from './pages/Settings/ExportModal'
import ImportModal from './pages/Settings/ImportModal'
import BrowserSetupModal from './components/browser/BrowserSetupModal'
import AgentPermissionPrompt from './components/terminal/AgentPermissionPrompt'
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
  // Reached when the boot IPC calls themselves reject. Without it the app sat
  // on the loading skeleton forever, since nothing else ever moves it off.
  | { phase: 'failed' }

/**
 * Shown when a screen's render throws. Deliberately not the whole window: the
 * boundaries below wrap each screen body, so a broken panel leaves the top bar,
 * the rail, and — the one that matters — the terminal's live pty session alone.
 */
function ScreenErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full flex-col items-start gap-3 overflow-y-auto bg-canvas-inset p-6">
      <Callout tone="danger" title={t('errorBoundary.title')}>
        {t('errorBoundary.body')}
      </Callout>
      <Button size="sm" onClick={onRetry}>
        {t('errorBoundary.tryAgain')}
      </Button>
      <details className="text-[11px] text-text-faint">
        <summary className="cursor-pointer">{t('errorBoundary.details')}</summary>
        <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap">{error.message}</pre>
      </details>
    </div>
  )
}

/** One boundary per screen, so the others keep running when one of them throws. */
function ScreenBoundary({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <ErrorBoundary
      label={label}
      fallback={(error, reset) => <ScreenErrorFallback error={error} onRetry={reset} />}
    >
      {children}
    </ErrorBoundary>
  )
}

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
                  <ScreenBoundary label="WorkspacePage">
                    <WorkspacePage
                      layout={layout}
                      setSidebarVisible={setSidebarVisible}
                      setDockVisible={setDockVisible}
                      setDockTab={setDockTab}
                      setSidebarWidth={setSidebarWidth}
                      setDockHeight={setDockHeight}
                    />
                  </ScreenBoundary>
                </div>
                <div className={screen === 'indexedJobs' ? 'h-full' : 'hidden'}>
                  <ScreenBoundary label="IndexedJobsPage">
                    <IndexedJobsPage />
                  </ScreenBoundary>
                </div>
              </div>
            </div>
          </div>
          {screen === 'settings' && (
            <div className="flex h-full flex-col">
              <div className="flex h-nav shrink-0 items-center border-b border-border bg-canvas px-3">
                <button
                  onClick={() => setScreen('workspace')}
                  className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-muted hover:text-text"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
                    <path
                      d="M19 12H5M5 12l6-6M5 12l6 6"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t('topBar.backToWorkspace')}
                </button>
                <div className="ml-auto flex items-center">
                  <DevBuildTag />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <ScreenBoundary label="SettingsPage">
                  <SettingsPage
                    initialSection={settingsSection}
                    onOpenExport={() => setExportOpen(true)}
                    onOpenImport={() => setImportOpen(true)}
                  />
                </ScreenBoundary>
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
      <AgentPermissionPrompt />
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

/** The boot check itself failed — the one screen that cannot assume a working database. */
function BootFailure({ onRetry }: { onRetry: () => void }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full flex-col items-start gap-3 bg-canvas-inset p-6">
      <Callout tone="danger" title={t('boot.failedTitle')}>
        {t('boot.failedBody')}
      </Callout>
      <Button size="sm" onClick={onRetry}>
        {t('boot.failedRetry')}
      </Button>
    </div>
  )
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
    void (async () => {
      setBoot({ phase: 'loading' })
      try {
        const status = await window.api.storageLocation.getStatus()
        if (status.startupFallbackWarning) setStartupWarning(status.startupFallbackWarning)
        if (status.needsRecovery) {
          setBoot({ phase: 'storage-recovery', status })
          return
        }
        const onboardingStatus = await window.api.onboarding.getStatus()
        setBoot({ phase: onboardingStatus.completed ? 'ready' : 'onboarding' })
      } catch (err) {
        // Both calls reach the database, so this is what an unopenable one
        // looks like from here. Left as its own phase with a retry rather than
        // an unhandled rejection and a skeleton nothing ever replaces.
        console.error('Boot state check failed', err)
        setBoot({ phase: 'failed' })
      }
    })()
  }

  useEffect(checkBootState, [])

  return (
    <ShortcutsProvider>
      <LocaleProvider>
        <ThemeProvider>
          <ToastProvider>
            <StartupWarningToast warning={startupWarning} />
            <ScreenBoundary label="App">
              {boot.phase === 'loading' && (
                <div className="flex h-full flex-col gap-2 bg-canvas-inset p-6">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-32 w-full" />
                </div>
              )}
              {boot.phase === 'failed' && <BootFailure onRetry={checkBootState} />}
              {boot.phase === 'storage-recovery' && (
                <StorageRecoveryFlow status={boot.status} onResolved={checkBootState} />
              )}
              {boot.phase === 'onboarding' && <OnboardingFlow onComplete={() => setBoot({ phase: 'ready' })} />}
              {boot.phase === 'ready' && <MainShell />}
            </ScreenBoundary>
          </ToastProvider>
        </ThemeProvider>
      </LocaleProvider>
    </ShortcutsProvider>
  )
}
