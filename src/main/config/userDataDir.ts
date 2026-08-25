import { app } from 'electron'
import { basename, dirname, join } from 'path'

const DEV_SUFFIX = '-dev'

/** True when Chromium's own switch already pins userData somewhere explicit — an override we must not second-guess. */
function hasExplicitUserDataOverride(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))
}

/**
 * The dev userData dir for a given default one: a sibling directory with a
 * `-dev` suffix (…/applyer -> …/applyer-dev). Kept pure so the suffixing
 * rule — including its idempotency — is testable without a real Electron app.
 */
export function devUserDataDir(defaultDir: string): string {
  const name = basename(defaultDir)
  if (name === '' || name.endsWith(DEV_SUFFIX)) return defaultDir
  return join(dirname(defaultDir), `${name}${DEV_SUFFIX}`)
}

/**
 * Point unpackaged runs at their own userData dir (…/applyer-dev) so
 * `npm run dev` never shares the installed build's database, settings,
 * screenshots, documents, storage-location pointer, terminal workspace, or
 * MCP socket. Packaged builds stay on the OS default (…/applyer).
 *
 * Must run before anything reads app.getPath('userData') — Electron resolves
 * and caches that path on first read — which is why index.ts calls this ahead
 * of the bootstrap import rather than from inside app.whenReady().
 */
export function applyDevUserDataDir(): void {
  if (app.isPackaged) return
  if (hasExplicitUserDataOverride(process.argv)) return
  try {
    const current = app.getPath('userData')
    const devDir = devUserDataDir(current)
    if (devDir !== current) app.setPath('userData', devDir)
  } catch (err) {
    // Never fatal — a failure here only means dev keeps using the default
    // directory. Too early for the logger (which resolves paths of its own),
    // so this goes to the dev console.
    console.error(`Could not redirect the dev userData directory: ${String(err)}`)
  }
}
