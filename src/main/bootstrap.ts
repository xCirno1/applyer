import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import './logger'
import { appLogger } from './logger'
import { registerApplyerFileProtocol } from './protocols'
import { createMainWindow } from './window'
import { initDatabase, closeDatabase } from './db'
import { registerTerminalIpc, setTerminalTarget } from './ipc/terminal'
import { registerJobsIpc } from './ipc/jobs'
import { registerIndexedJobsIpc } from './ipc/indexedJobs'
import { registerExclusionsIpc } from './ipc/exclusions'
import { registerCompanyBoardsIpc } from './ipc/companyBoards'
import { registerProfileIpc } from './ipc/profile'
import { registerOnboardingIpc } from './ipc/onboarding'
import { registerBrowserControlIpc } from './ipc/browserControl'
import { registerBrowserSetupIpc } from './ipc/browserSetup'
import { registerSettingsIpc } from './ipc/settings'
import { registerLogsIpc } from './ipc/logs'
import { registerAppIpc } from './ipc/app'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerDataTransferIpc } from './ipc/dataTransfer'
import { registerStorageLocationIpc } from './ipc/storageLocation'
import { registerJobsBroadcastTarget } from './ipc/jobsBroadcast'
import { fallbackToDefaultStorageAfterOpenFailure, resolveActiveStorageRoot } from './config/storageLocation'
import { startMcpServerIfStorageResolved, closeMcpSocketServer } from './storageLocation/bootGate'
import { disposeAllSessions } from './terminal/ptyManager'
import { applyProductionCsp } from './security'
import { configureApplicationMenu } from './menu'
import { closeAllBrowsers } from './browser/browserController'
import { writeAgentInstructions } from './config/agentInstructions'
import { reconcileOrphanedBlockedJobs } from './jobActions'
import { pruneIndexedJobs } from './db/repositories/indexedJobsRepository'

/**
 * Without these, a throw that escapes an async boundary takes the whole app
 * with it and leaves nothing behind: Node's default for an unhandled
 * rejection is to crash the process, and a packaged build has no console for
 * the stack trace to land in, so the user sees the window vanish and
 * `app.log` ends mid-session with no explanation.
 *
 * They log and keep running, deliberately. Almost everything that reaches
 * here is one background task failing — a browser continuation, a board
 * fetch, a notification — and killing the user's terminal session and open
 * job board over it is a worse outcome than carrying on degraded with a line
 * in the log. Anything that genuinely cannot continue already quits
 * explicitly (see the database failure path in `initializeApp`).
 */
function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    appLogger.error(`Uncaught exception in the main process: ${err.stack ?? String(err)}`)
  })
  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    appLogger.error(`Unhandled promise rejection in the main process: ${detail}`)
  })
}

/**
 * A window, plus the two module-level references that have to point at
 * whichever one is current. Neither *registers* anything — the IPC handlers
 * behind them are registered once per process in `initializeApp` — so this is
 * safe to call again for the replacement window macOS asks for on `activate`.
 */
function openMainWindow(): BrowserWindow {
  const window = createMainWindow()
  setTerminalTarget(window.webContents)
  registerJobsBroadcastTarget(window.webContents)
  return window
}

function initializeApp(): void {
  electronApp.setAppUserModelId('com.applyer.app')

  try {
    const settingsWarnings: unknown = JSON.parse(process.env.APPLYER_SETTINGS_WARNINGS ?? '[]')
    if (Array.isArray(settingsWarnings)) {
      for (const warning of settingsWarnings) appLogger.warn(String(warning))
    }
  } catch (error) {
    appLogger.warn(`Could not decode settings warnings: ${String(error)}`)
  } finally {
    delete process.env.APPLYER_SETTINGS_WARNINGS
  }

  if (!is.dev) {
    applyProductionCsp()
    configureApplicationMenu()
  }

  registerApplyerFileProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  resolveActiveStorageRoot()

  try {
    initDatabase()
  } catch (err) {
    closeDatabase()
    if (!fallbackToDefaultStorageAfterOpenFailure(String(err))) {
      appLogger.error(`Database initialization failed: ${String(err)}`)
      app.quit()
      return
    }
    try {
      initDatabase()
    } catch (fallbackErr) {
      appLogger.error(`Default fallback database initialization failed: ${String(fallbackErr)}`)
      app.quit()
      return
    }
  }

  reconcileOrphanedBlockedJobs()
  pruneIndexedJobs()
  writeAgentInstructions()

  registerJobsIpc()
  registerIndexedJobsIpc()
  registerExclusionsIpc()
  registerCompanyBoardsIpc()
  registerProfileIpc()
  registerOnboardingIpc()
  registerBrowserControlIpc()
  registerBrowserSetupIpc()
  registerSettingsIpc()
  registerLogsIpc()
  registerAppIpc()
  registerClipboardIpc()
  registerDataTransferIpc()
  registerStorageLocationIpc()
  registerTerminalIpc()

  // No-op if storage-location recovery is currently needed — started once
  // the user resolves it, from the recovery IPC handlers instead.
  startMcpServerIfStorageResolved()

  openMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow()
    }
  })
}

installCrashHandlers()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  void app.whenReady().then(initializeApp)
}

// The pty sessions go with the window they were driving; the database does
// not. On macOS the app stays alive with no windows and reopens one from the
// dock, and closing the connection here left every IPC handler in that new
// window throwing "Database not initialized" — so it is closed on the way
// out instead, which is the same moment for every other platform anyway —
// the `app.quit()` in this handler is what fires `before-quit`.
app.on('window-all-closed', () => {
  disposeAllSessions()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeAllSessions()
  closeMcpSocketServer()
  void closeAllBrowsers()
  closeDatabase()
})
