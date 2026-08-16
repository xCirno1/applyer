import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// Not __dirname-relative — this module can end up bundled into a
// dynamically-imported chunk under out/main/chunks/, which breaks a path
// computed relative to its own location. app.getAppPath() is stable.
const outDir = join(app.getAppPath(), 'out')

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1d23',
    webPreferences: {
      preload: join(outDir, 'preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
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
