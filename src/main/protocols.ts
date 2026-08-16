import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { screenshotsDir } from './config/paths'

// Must run before app.whenReady() — Electron requires privileged schemes to
// be registered at module load time.
protocol.registerSchemesAsPrivileged([
  { scheme: 'applyer-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }
])

/**
 * Serves screenshots to the renderer without exposing raw file:// access.
 * URLs look like applyer-file://screenshots/<filename> — the filename is
 * validated to be a bare name (no path traversal) before joining it against
 * the one directory this protocol is allowed to read from.
 */
export function registerApplyerFileProtocol(): void {
  protocol.handle('applyer-file', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'screenshots') {
      return new Response('Not found', { status: 404 })
    }

    const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return new Response('Forbidden', { status: 403 })
    }

    const filePath = join(screenshotsDir(), filename)
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
