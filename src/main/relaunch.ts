import { app } from 'electron'
import { spawn } from 'child_process'
import { appLogger } from './logger'

export interface RelaunchOptions {
  execPath: string
  args: string[]
}

const WAIT_FOR_PARENT_AND_EXEC = [
  'parent_pid="$1"',
  'app_image="$2"',
  'shift 2',
  'while kill -0 "$parent_pid" 2>/dev/null; do sleep 0.1; done',
  'exec "$app_image" "$@"'
].join('\n')

/** Arguments for `/bin/sh`; kept pure so paths and forwarded arguments can be tested safely. */
export function appImageLauncherArgsFor(parentPid: number, options: RelaunchOptions): string[] {
  return [
    '-c',
    WAIT_FOR_PARENT_AND_EXEC,
    'applyer-appimage-relaunch',
    String(parentPid),
    options.execPath,
    ...options.args
  ]
}

/**
 * The stable executable and arguments needed to restart an AppImage, or
 * `null` when Electron's normal relaunch support is appropriate.
 *
 * The case that needs them is Linux AppImage. There, `process.execPath` points
 * at the Electron binary *inside* the temporary squashfs mount the AppImage
 * runtime creates (`/tmp/.mount_Applyer…/`), and that mount is torn down as the
 * process exits — which is exactly when Electron tries to spawn the
 * replacement. The spawn therefore has nothing to exec and the app simply
 * closes with no restart. `$APPIMAGE`, set by the AppImage runtime, is the
 * stable path of the `.AppImage` file itself and survives the exit.
 *
 * Kept pure (env/argv passed in) so every branch is testable without actually
 * restarting anything.
 */
export function relaunchOptionsFor(env: NodeJS.ProcessEnv, argv: readonly string[]): RelaunchOptions | null {
  const appImage = env.APPIMAGE
  if (typeof appImage !== 'string' || appImage.trim() === '') return null
  // argv[0] is the binary itself — Electron's own default passes argv.slice(1).
  return { execPath: appImage, args: argv.slice(1) }
}

/**
 * Start a tiny detached system-shell wrapper that waits for this process to
 * disappear before executing the AppImage. Waiting avoids racing Applyer's
 * single-instance lock, while using a process outside the AppImage mount means
 * the launcher itself remains executable after the old mount is torn down.
 *
 * Electron's app.relaunch() is intentionally not used for AppImages: on Linux
 * it can silently fail when the app was opened from a terminal or desktop
 * launcher, even when given the stable $APPIMAGE path.
 */
function relaunchAppImage(options: RelaunchOptions): void {
  const launcher = spawn(
    '/bin/sh',
    appImageLauncherArgsFor(process.pid, options),
    { detached: true, stdio: 'ignore' }
  )

  let settled = false
  launcher.once('error', (err) => {
    if (settled) return
    settled = true
    appLogger.error(`Could not start the AppImage relaunch helper: ${err.message}`)
  })
  launcher.once('spawn', () => {
    if (settled) return
    settled = true
    launcher.unref()
    // Keep the normal quit lifecycle so terminals, browsers, the database,
    // and the MCP socket receive their existing shutdown handling. The shell
    // wrapper starts the replacement only after that lifecycle has completed.
    app.quit()
  })
}

/**
 * Restart the whole main process. Callers use this rather than
 * `app.relaunch()` directly so the AppImage handling above is applied
 * everywhere, and so a failure to schedule the restart is logged instead of
 * escaping into an IPC handler.
 *
 * Note for `npm run dev`: the replacement process cannot survive there, since
 * Electron runs as a child of the electron-vite dev server, which shuts down
 * as soon as its child exits. The app will close and stay closed — that is a
 * dev-only limitation of the supervisor, not of this function.
 */
export function relaunchApp(): void {
  try {
    const options = relaunchOptionsFor(process.env, process.argv)
    if (options) {
      appLogger.info(`Relaunching via AppImage at ${options.execPath}`)
      relaunchAppImage(options)
      return
    }

    app.relaunch()
    if (!app.isPackaged) {
      appLogger.info('Relaunch requested from an unpackaged run — the dev supervisor will not bring the app back; restart `npm run dev`.')
    }
    app.quit()
  } catch (err) {
    appLogger.error(`Could not relaunch: ${err instanceof Error ? err.message : String(err)}`)
  }
}
