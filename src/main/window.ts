import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { encodedSettingsArgument } from './config/settings'

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
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(outDir, 'renderer/index.html'))
  }

  return window
}
