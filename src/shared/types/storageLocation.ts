import type { AppError } from './errorCodes'

export interface StorageLocationPointer {
  schemaVersion: 1
  /** Absolute path to the custom root, or null to use the fixed OS-default userData dir. */
  customRoot: string | null
}

export interface StorageLocationStatus {
  activeRoot: string
  isDefault: boolean
  defaultRoot: string
  /** One-shot: set only when the pointer file itself was corrupt/unreadable (nothing concrete to retry). Consumed by the first getStatus() call. */
  startupFallbackWarning: AppError | null
  /**
   * Stable (not one-shot) — true when a configured custom root is currently
   * unavailable and the app is running on a substitute (default) database
   * until the user explicitly resolves it via retryCustomLocation() or
   * useDefaultLocation(). The renderer blocks the whole app behind a
   * recovery screen while this is true, since silently continuing risks
   * orphaning work in the substitute database.
   */
  needsRecovery: boolean
  recoveryReason: AppError | null
  /** The pointer's customRoot that couldn't be used, so the recovery UI can display/retry it. */
  unavailableCustomRoot: string | null
}

export type StorageLocationValidation =
  | { ok: true }
  | { ok: false; error: AppError; neededBytes?: number; availableBytes?: number }

export type StorageLocationMigrationResult = { ok: true } | { ok: false; error: AppError }

export type StorageLocationPickResult = { ok: true; path: string } | { ok: false; canceled: true }

export type StorageLocationProgressPhase = 'documents' | 'screenshots' | 'logs' | 'database' | 'verifying' | 'finalizing'

export interface StorageLocationProgressPayload {
  phase: StorageLocationProgressPhase
  percent: number
}
