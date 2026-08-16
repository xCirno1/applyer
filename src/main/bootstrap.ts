import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import './logger'
import { appLogger } from './logger'
import { registerApplyerFileProtocol } from './protocols'
import { createMainWindow } from './window'
import { initDatabase, closeDatabase } from './db'
import { registerTerminalIpc } from './ipc/terminal'
import { registerJobsIpc } from './ipc/jobs'
import { registerExclusionsIpc } from './ipc/exclusions'
import { registerProfileIpc } from './ipc/profile'
import { registerOnboardingIpc } from './ipc/onboarding'
import { registerBrowserControlIpc } from './ipc/browserControl'
import { registerSettingsIpc } from './ipc/settings'
import { registerLogsIpc } from './ipc/logs'
import { registerJobsBroadcastTarget } from './ipc/jobsBroadcast'
import { disposeAllSessions } from './terminal/ptyManager'
import { applyProductionCsp } from './security'
import { startMcpSocketServer } from './mcp-server/transportSocket'
import { closeAllBrowsers } from './browser/browserController'
import { mcpSocketPath } from './config/paths'
import { writeAgentInstructions } from './config/agentInstructions'
import { reconcileOrphanedBlockedJobs } from './jobActions'

let mcpSocketServer: ReturnType<typeof startMcpSocketServer> | undefined

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.applyer.app')

  if (!is.dev) {
    applyProductionCsp()
  }

  registerApplyerFileProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    initDatabase()
  } catch (err) {
    appLogger.error(`Database initialization failed: ${String(err)}`)
    app.quit()
    return
  }

  reconcileOrphanedBlockedJobs()
  writeAgentInstructions()

  registerJobsIpc()
  registerExclusionsIpc()
  registerProfileIpc()
  registerOnboardingIpc()
  registerBrowserControlIpc()
  registerSettingsIpc()
  registerLogsIpc()

  mcpSocketServer = startMcpSocketServer(mcpSocketPath())

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
})

app.on('window-all-closed', () => {
  disposeAllSessions()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeAllSessions()
  mcpSocketServer?.close()
  void closeAllBrowsers()
})
