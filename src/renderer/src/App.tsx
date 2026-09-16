import { useState, useEffect, useCallback, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import logo from './assets/logo.png'
import WorkspacePage from './pages/Workspace/WorkspacePage'
import IndexedJobsPage from './pages/IndexedJobs/IndexedJobsPage'
import ResumesPage, { type ResumesTab } from './pages/Resumes/ResumesPage'
import RunStatsPage from './pages/RunStats/RunStatsPage'
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
import ShellDock from './components/workspace/ShellDock'
import type { DockScreen } from './components/workspace/workspaceLayout'
import { pasteIntoTerminal } from './components/terminal/terminalBridge'
import { TerminalInputContext } from './providers/TerminalInputContext'
import { SettingsNavContext } from './providers/SettingsNavContext'
import CaptchaAlertProvider from './providers/CaptchaAlertProvider'
import ThemeProvider from './providers/ThemeProvider'
import LocaleProvider from './providers/LocaleProvider'
import ShortcutsProvider from './providers/ShortcutsProvider'
import { useShortcutHandler } from './providers/ShortcutsContext'
import { useJobsStore } from './state/jobsStore'
import { useProfileStore } from './state/profileStore'
import { useResumesStore } from './state/resumesStore'
import { syncUnsavedChangesToMain } from './state/unsavedChangesStore'
import ConfirmDialog from './components/ui/ConfirmDialog'
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
    <ErrorBoundary label={label} fallback={(error, reset) => <ScreenErrorFallback error={error} onRetry={reset} />}>
      {children}
    </ErrorBoundary>
  )
}

function MainShell(): ReactElement {
  const { t } = useTranslation('workspace')
  const toast = useToast()
  const [screen, setScreen] = useState<Screen>('workspace')
  const [settingsSection, setSettingsSection] = useState<SectionId>('profile')
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const activeJob = useJobsStore((s) => s.activeJob)
  const closeJob = useJobsStore((s) => s.closeJob)
  const browserSetup = useBrowserSetupState()
  const subscribeToProfileUpdates = useProfileStore((s) => s.subscribeToUpdates)
  const subscribeToResumeUpdates = useResumesStore((s) => s.subscribeToUpdates)
  const selectResumeVariant = useResumesStore((s) => s.select)
  const [resumesTabRequest, setResumesTabRequest] = useState<{
    tab: ResumesTab
    nonce: number
  } | null>(null)
  useShortcutHandler('app.toggleSettings', () => setScreen((s) => (s === 'settings' ? 'workspace' : 'settings')))

  // Here rather than in the Settings profile form, which only exists while
  // that section is open — see profileStore's subscribeToUpdates.
  useEffect(() => subscribeToProfileUpdates(), [subscribeToProfileUpdates])
  // Same reasoning: the Resume Variants screen is mounted-but-hidden and the
  // board's "tailored" tags read the variant list, so the subscription lives
  // here and not on the page.
  useEffect(() => subscribeToResumeUpdates(), [subscribeToResumeUpdates])

  // Closing the window over unsaved edits: main holds the close back and
  // asks here, since the dialog has to be the app's own (no native prompts)
  // and the editors that know about the edits live under this shell.
  const [closeRequested, setCloseRequested] = useState(false)
  useEffect(() => syncUnsavedChangesToMain((value) => window.api.app.setUnsavedChanges(value)), [])
  useEffect(() => window.api.app.onCloseRequested(() => setCloseRequested(true)), [])

  // A job with a variant assigned lands on that variant; one without lands
  // on the master, which is where "there is nothing tailored yet" is
  // explained and fixed.
  const openResumeVariant = (jobId: string): void => {
    const variantId = useResumesStore.getState().variantIdByJob.get(jobId) ?? null
    selectResumeVariant(variantId)
    setResumesTabRequest((previous) => ({
      tab: variantId ? 'variants' : 'master',
      nonce: (previous?.nonce ?? 0) + 1
    }))
    setScreen('resumes')
  }

  // Owned here (not inside WorkspacePage) so the top bar it drives — logo,
  // menu, settings — can span the full window width, above the icon rail,
  // the same way VS Code's menu bar spans full width above its activity
  // bar rather than being indented past it.
  const { layout, setSidebarVisible, setDockVisible, setDockTab, setSidebarWidth, setDockHeight } = useWorkspaceLayout()

  // The dock is one instance under all four rail screens, but each screen
  // remembers whether it is showing; every toggle here is for the screen the
  // user is looking at (Settings has no dock, so it counts as the workspace).
  const dockScreen: DockScreen = screen === 'settings' ? 'workspace' : screen
  const dockVisible = layout.dockVisible[dockScreen]

  const showTerminalTab = (): void => {
    setDockVisible(dockScreen, true)
    setDockTab('terminal')
  }

  // "Send to terminal" from the resume prompts: show the dock here, switch
  // to the Terminal tab, type the sentence (the user still presses Enter).
  const sendToTerminal = useCallback(
    (text: string): void => {
      setDockVisible(dockScreen, true)
      setDockTab('terminal')
      if (!pasteIntoTerminal(text)) toast.error(t('topBar.terminalUnavailable'))
    },
    [dockScreen, setDockVisible, setDockTab, toast, t]
  )

  useShortcutHandler('view.toggleOverview', () => setSidebarVisible(!layout.sidebarVisible))
  useShortcutHandler('view.toggleConsole', () => setDockVisible(dockScreen, !dockVisible))
  useShortcutHandler('dock.showTerminal', showTerminalTab)
  useShortcutHandler('dock.showLogs', () => {
    setDockVisible(dockScreen, true)
    setDockTab('logs')
  })

  const openSettings = (section?: SectionId): void => {
    if (section) setSettingsSection(section)
    setScreen('settings')
  }

  return (
    <div className="flex h-full flex-col bg-canvas-inset">
      <CaptchaAlertProvider>
        <TerminalInputContext.Provider value={sendToTerminal}>
          <SettingsNavContext.Provider value={openSettings}>
            <main className="min-h-0 flex-1">
              {/* The four rail screens stay mounted even while another is
                showing (or Settings is open): the shell-level dock below them
                owns the terminal's live pty session, Workspace owns the jobs
                live-update subscription, Indexed Jobs and Runs own their own,
                all of which a remount would kill/drop. Toggled via `hidden`
                rather than conditional rendering for that reason. Settings
                mounts fresh each visit since it holds no state worth
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
                    dockVisible={dockVisible}
                    onToggleDock={() => setDockVisible(dockScreen, !dockVisible)}
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
                    <ShellDock
                      layout={layout}
                      visible={dockVisible}
                      setDockTab={setDockTab}
                      setDockHeight={setDockHeight}
                      onHide={() => setDockVisible(dockScreen, false)}
                    >
                      <div className={screen === 'workspace' ? 'h-full' : 'hidden'}>
                        <ScreenBoundary label="WorkspacePage">
                          <WorkspacePage
                            layout={layout}
                            setSidebarVisible={setSidebarVisible}
                            setSidebarWidth={setSidebarWidth}
                          />
                        </ScreenBoundary>
                      </div>
                      <div className={screen === 'indexedJobs' ? 'h-full' : 'hidden'}>
                        <ScreenBoundary label="IndexedJobsPage">
                          <IndexedJobsPage />
                        </ScreenBoundary>
                      </div>
                      <div className={screen === 'resumes' ? 'h-full' : 'hidden'}>
                        <ScreenBoundary label="ResumesPage">
                          <ResumesPage requestedTab={resumesTabRequest} />
                        </ScreenBoundary>
                      </div>
                      <div className={screen === 'runs' ? 'h-full' : 'hidden'}>
                        <ScreenBoundary label="RunStatsPage">
                          <RunStatsPage />
                        </ScreenBoundary>
                      </div>
                    </ShellDock>
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
          </SettingsNavContext.Provider>
        </TerminalInputContext.Provider>
      </CaptchaAlertProvider>
      {/* Global — driven entirely by jobsStore's openJobId/activeJob, so any
          panel on any screen (board, sidebar, Indexed Jobs) can open it. */}
      <JobDetailModal job={activeJob} onClose={closeJob} onOpenResume={openResumeVariant} />
      {/* Global too, for the same reason — the File menu pops these directly
          without navigating to Settings > Data first. */}
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <AgentPermissionPrompt />
      <ConfirmDialog
        open={closeRequested}
        title={t('closeGuard.title')}
        message={t('closeGuard.message')}
        confirmLabel={t('closeGuard.confirm')}
        danger
        onConfirm={() => {
          setCloseRequested(false)
          window.api.app.confirmClose()
        }}
        onCancel={() => setCloseRequested(false)}
      />
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
