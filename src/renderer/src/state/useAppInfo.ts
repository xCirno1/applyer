import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types/ipcEvents'

let pending: Promise<AppInfo> | null = null

function isAppInfo(value: unknown): value is AppInfo {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.version === 'string' && typeof v.isDevBuild === 'boolean' && typeof v.userDataDir === 'string'
}

/**
 * One IPC round-trip shared by every consumer: `AppInfo` is fixed for the
 * process lifetime (see its doc comment), so the in-flight promise is cached
 * at module level. A failure clears the cache, so the next mount retries
 * rather than being stuck with the rejection forever.
 */
export function loadAppInfo(): Promise<AppInfo> {
  if (!pending) {
    pending = window.api.app
      .getInfo()
      .then((info) => {
        if (!isAppInfo(info)) throw new Error('Malformed app info received from the main process')
        return info
      })
      .catch((err: unknown) => {
        pending = null
        throw err
      })
  }
  return pending
}

/** Test-only: drops the module-level cache so each case starts from a clean fetch. */
export function __resetAppInfoCache(): void {
  pending = null
}

/** Version / dev-build marker / userData directory. `null` while loading, and if the fetch failed (callers render the neutral, unmarked state). */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let active = true
    loadAppInfo().then(
      (value) => {
        if (active) setInfo(value)
      },
      (err: unknown) => {
        console.error(`Could not load app info: ${String(err)}`)
      }
    )
    return () => {
      active = false
    }
  }, [])

  return info
}
