import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import './logger'
import { appLogger } from './logger'
import { registerApplyerFileProtocol } from './protocols'
import { createMainWindow } from './window'
import { initDatabase, closeDatabase } from './db'
import { registerTerminalIpc } from './ipc/terminal'
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

  // No-op if storage-location recovery is currently needed — started once
  // the user resolves it, from the recovery IPC handlers instead.
  startMcpServerIfStorageResolved()

  const mainWindow = createMainWindow()
  registerTerminalIpc(mainWindow.webContents)
  registerJobsBroadcastTarget(mainWindow.webContents)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createMainWindow()
      registerTerminalIpc(window.webContents)
      registerJobsBroadcastTarget(window.webContents)
    }
  })
}

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

app.on('window-all-closed', () => {
  disposeAllSessions()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeAllSessions()
  closeMcpSocketServer()
  void closeAllBrowsers()
})
