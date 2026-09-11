import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { encodedSettingsArgument } from './config/settings'
import { appLogger } from './logger'
import { isNavigableUrl } from '@shared/url'

// Not __dirname-relative — this module can end up bundled into a
// dynamically-imported chunk under out/main/chunks/, which breaks a path
// computed relative to its own location. app.getAppPath() is stable.
const outDir = join(app.getAppPath(), 'out')

// Windows/macOS packaged builds already carry the icon baked into the
// exe/app bundle (from build.icon in package.json) — this only matters for
// the taskbar icon in dev and on Linux, which reads it from BrowserWindow's
// `icon` option at runtime. Same packaged-vs-dev resource lookup as
// mcpConfigWriter's bridge script.
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(app.getAppPath(), 'resources', 'icon.png')

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1d23',
    icon: iconPath,
    webPreferences: {
      preload: join(outDir, 'preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [encodedSettingsArgument()]
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // Any link the app tries to open externally goes to the OS browser, never a
  // second Electron window with full node/main-process access.
  //
  // Only http(s) gets that far. The links that reach here are job URLs, and a
  // job URL is not something the user typed: it arrives from the agent's
  // `queue_job` or is copied out of an ATS feed's `applyUrl`. `openExternal`
  // hands whatever it is given to the OS, which will happily act on a `file:`
  // or `smb:` URL — so the scheme is checked before the handoff rather than
  // trusting the source. See `@shared/url`.
  window.webContents.setWindowOpenHandler((details) => {
    if (isNavigableUrl(details.url)) {
      // Rejects when no handler exists for the URL; nothing to recover from,
      // but it should not surface as an unhandled rejection either.
      shell.openExternal(details.url).catch((err) => {
        appLogger.warn(`Could not open ${details.url} externally: ${String(err)}`)
      })
    } else {
      appLogger.warn(`Refused to open a non-http(s) URL externally: ${details.url}`)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(outDir, 'renderer/index.html'))
  }

  return window
}
