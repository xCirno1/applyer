export const DEVELOPER_MODE_STORAGE_KEY = 'applyer:developer-mode:v1'

export function readDeveloperMode(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(DEVELOPER_MODE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeDeveloperMode(enabled: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(DEVELOPER_MODE_STORAGE_KEY, String(enabled))
  } catch {
    // A blocked/full localStorage only makes developer mode session-scoped.
  }
}
