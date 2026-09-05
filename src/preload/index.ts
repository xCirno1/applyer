import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppInfo,
  type TerminalCreateOptions,
  type TerminalCreateResult,
  type McpCliId,
  type McpConfigDetection,
  type McpAutoConfigureResult,
  type McpScope,
  type McpVerifyResult,
  type AutoStartCommand,
  type OnboardingStatus,
  type UploadDocumentRequest,
  type CaptchaDetectedPayload,
  type CaptchaResolvedPayload,
  type BrowserDownloadProgressPayload,
  type BrowserSetupStatusPayload,
  type BrowserPreference,
  type ResolvedBrowserStatus,
  type DialogLabels
} from '@shared/types/ipcEvents'
import type { JobRecord, ListJobsQuery, ListJobsResult } from '@shared/types/job'
import type { DocumentSummary, ProfileFields, ProfileWithDocuments, StorageMode } from '@shared/types/profile'
import type { ListActivityQuery, ListActivityResult } from '@shared/types/activity'
import type { ExclusionRecord, ListExclusionsQuery, ListExclusionsResult } from '@shared/types/exclusion'
import type {
  BoardCsvImportOptions,
  BoardCsvImportResult,
  BoardCsvMapping,
  BoardCsvPickResult,
  BoardCsvPlanResult,
  BoardFetchedPayload,
  BoardProbeCandidate,
  CompanyBoardRecord,
  FetchCompanyBoardsResult,
  ListCompanyBoardsQuery,
  ListCompanyBoardsResult
} from '@shared/types/companyBoard'
import type { AppError } from '@shared/types/errorCodes'

/**
 * A successful add reports more than "it worked": whether the board was
 * already tracked, how many postings it holds right now (0 is a real answer),
 * whether it could be reached at all, and whether the company answered on
 * more than one ATS — which is what an in-progress migration looks like.
 */
type AddCompanyBoardResponse =
  | {
      ok: true
      status: 'added' | 'already_tracked'
      board: CompanyBoardRecord
      jobCount: number
      verified: boolean
      ambiguous: boolean
      candidates: BoardProbeCandidate[]
    }
  | { ok: false; error: AppError }
import type { IndexedJobsRetention, ListIndexedJobsQuery, ListIndexedJobsResult } from '@shared/types/indexedJob'
import type { StorageStats } from '@shared/types/storage'
import type {
  NotificationLocale,
  NotificationPreferences,
  NotificationTestKind
} from '@shared/types/notification'
import type {
  StorageLocationStatus,
  StorageLocationValidation,
  StorageLocationMigrationResult,
  StorageLocationPickResult,
  StorageLocationProgressPayload
} from '@shared/types/storageLocation'
import type {
  ExportSelection,
  ExportSizes,
  CsvTable,
  ExportFileResult,
  ImportPickResult,
  ImportApplyResult,
  ExportBundle
} from '@shared/types/dataTransfer'
import type { ThemeState } from '@shared/types/theme'
import type {
  AdvancedSettingsSnapshot,
  ApplyerSettingKey,
  ApplyerSettings
} from '@shared/settings'

function settingsFromArguments(argv: readonly string[]): ApplyerSettings | undefined {
  const prefix = '--applyer-settings='
  const argument = argv.find((item) => item.startsWith(prefix))
  if (!argument) return undefined
  try {
    return JSON.parse(decodeURIComponent(argument.slice(prefix.length))) as ApplyerSettings
  } catch {
    return undefined
  }
}

const runtimeSettings = settingsFromArguments(process.argv)
if (runtimeSettings) contextBridge.exposeInMainWorld('applyerSettings', runtimeSettings)

const terminalApi = {
  create: (options: TerminalCreateOptions): Promise<TerminalCreateResult> =>
    ipcRenderer.invoke(IPC.terminal.create, options),
  write: (sessionId: string, data: string): void => ipcRenderer.send(IPC.terminal.write, sessionId, data),
  resize: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.terminal.resize, sessionId, cols, rows),
  dispose: (sessionId: string): void => ipcRenderer.send(IPC.terminal.dispose, sessionId),
  onData: (callback: (payload: { sessionId: string; data: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; data: string }): void =>
      callback(payload)
    ipcRenderer.on(IPC.terminal.onData, listener)
    return () => ipcRenderer.removeListener(IPC.terminal.onData, listener)
  },
  onExit: (callback: (payload: { sessionId: string; exitCode: number }) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; exitCode: number }
    ): void => callback(payload)
    ipcRenderer.on(IPC.terminal.onExit, listener)
    return () => ipcRenderer.removeListener(IPC.terminal.onExit, listener)
  }
}

const jobsApi = {
  list: (query: ListJobsQuery): Promise<ListJobsResult> => ipcRenderer.invoke(IPC.jobs.list, query),
  get: (jobId: string): Promise<{ job: JobRecord | null }> => ipcRenderer.invoke(IPC.jobs.get, { jobId }),
  markSubmitted: (jobId: string): Promise<{ ok: boolean; job?: JobRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.jobs.markSubmitted, { jobId }),
  retry: (jobId: string): Promise<{ ok: boolean; job?: JobRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.jobs.retry, { jobId }),
  retryAll: (): Promise<{ ok: boolean; jobs: JobRecord[] }> => ipcRenderer.invoke(IPC.jobs.retryAll),
  retryMany: (jobIds: string[]): Promise<{ ok: boolean; jobs: JobRecord[] }> =>
    ipcRenderer.invoke(IPC.jobs.retryMany, { jobIds }),
  remove: (jobId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.jobs.remove, { jobId }),
  exclude: (
    jobId: string,
    reason?: string
  ): Promise<{ ok: boolean; exclusion?: ExclusionRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.jobs.exclude, { jobId, reason }),
  excludeMany: (jobIds: string[]): Promise<{ ok: boolean; excludedIds: string[] }> =>
    ipcRenderer.invoke(IPC.jobs.excludeMany, { jobIds }),
  unqueue: (jobId: string): Promise<{ ok: boolean; job?: JobRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.jobs.unqueue, { jobId }),
  unqueueMany: (jobIds: string[]): Promise<{ ok: boolean; unqueuedIds: string[] }> =>
    ipcRenderer.invoke(IPC.jobs.unqueueMany, { jobIds }),
  onUpdated: (callback: (job: JobRecord) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, job: JobRecord): void => callback(job)
    ipcRenderer.on(IPC.jobs.onUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.jobs.onUpdated, listener)
  },
  onRemoved: (callback: (payload: { jobId: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { jobId: string }): void => callback(payload)
    ipcRenderer.on(IPC.jobs.onRemoved, listener)
    return () => ipcRenderer.removeListener(IPC.jobs.onRemoved, listener)
  }
}

const indexedJobsApi = {
  list: (query: ListIndexedJobsQuery): Promise<ListIndexedJobsResult> =>
    ipcRenderer.invoke(IPC.indexedJobs.list, query),
  getRetention: (): Promise<IndexedJobsRetention> => ipcRenderer.invoke(IPC.indexedJobs.getRetention),
  setRetention: (value: IndexedJobsRetention): Promise<{ ok: boolean; deletedCount?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.indexedJobs.setRetention, { value }),
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.indexedJobs.onChanged, listener)
    return () => ipcRenderer.removeListener(IPC.indexedJobs.onChanged, listener)
  }
}

const companyBoardsApi = {
  list: (query: ListCompanyBoardsQuery): Promise<ListCompanyBoardsResult> =>
    ipcRenderer.invoke(IPC.companyBoards.list, query),
  add: (query: string, companyName?: string): Promise<AddCompanyBoardResponse> =>
    ipcRenderer.invoke(IPC.companyBoards.add, { query, companyName }),
  remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.companyBoards.remove, { id }),
  setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean; board?: CompanyBoardRecord; error?: AppError }> =>
    ipcRenderer.invoke(IPC.companyBoards.setEnabled, { id, enabled }),
  setEnabledMany: (ids: string[], enabled: boolean): Promise<{ ok: boolean; updated?: number; error?: AppError }> =>
    ipcRenderer.invoke(IPC.companyBoards.setEnabledMany, { ids, enabled }),
  removeMany: (ids: string[]): Promise<{ ok: boolean; removed?: number; error?: AppError }> =>
    ipcRenderer.invoke(IPC.companyBoards.removeMany, { ids }),
  /** Fetches these boards now, outside a search, and writes back what each answered. */
  fetch: (ids: string[]): Promise<FetchCompanyBoardsResult> => ipcRenderer.invoke(IPC.companyBoards.fetch, { ids }),
  pickCsv: (labels: DialogLabels): Promise<BoardCsvPickResult> =>
    ipcRenderer.invoke(IPC.companyBoards.pickCsv, { labels }),
  planCsv: (filePath: string, mapping: BoardCsvMapping, options: BoardCsvImportOptions): Promise<BoardCsvPlanResult> =>
    ipcRenderer.invoke(IPC.companyBoards.planCsv, { filePath, mapping, options }),
  importCsv: (
    filePath: string,
    mapping: BoardCsvMapping,
    options: BoardCsvImportOptions
  ): Promise<BoardCsvImportResult> => ipcRenderer.invoke(IPC.companyBoards.importCsv, { filePath, mapping, options }),
  /** Drops the picked file from the main process; sent when the import dialog closes. */
  releaseCsv: (): void => ipcRenderer.send(IPC.companyBoards.releaseCsv),
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.companyBoards.onChanged, listener)
    return () => ipcRenderer.removeListener(IPC.companyBoards.onChanged, listener)
  },
  /** Fires per board during a fetch, as each one lands, rather than once for the batch. */
  onFetched: (callback: (payload: BoardFetchedPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BoardFetchedPayload): void => callback(payload)
    ipcRenderer.on(IPC.companyBoards.onFetched, listener)
    return () => ipcRenderer.removeListener(IPC.companyBoards.onFetched, listener)
  }
}

const exclusionsApi = {
  list: (query: ListExclusionsQuery): Promise<ListExclusionsResult> => ipcRenderer.invoke(IPC.exclusions.list, query),
  add: (url: string, reason?: string): Promise<{ ok: boolean; exclusion?: ExclusionRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.exclusions.add, { url, reason }),
  remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.exclusions.remove, { id }),
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.exclusions.onChanged, listener)
    return () => ipcRenderer.removeListener(IPC.exclusions.onChanged, listener)
  }
}

const profileApi = {
  get: (): Promise<ProfileWithDocuments> => ipcRenderer.invoke(IPC.profile.get),
  save: (fields: ProfileFields): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.profile.save, fields),
  uploadDocument: (
    request: UploadDocumentRequest
  ): Promise<{ ok: boolean; document?: DocumentSummary; error?: string }> =>
    ipcRenderer.invoke(IPC.profile.uploadDocument, request),
  deleteDocument: (documentId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.profile.deleteDocument, { documentId }),
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.profile.onChanged, listener)
    return () => ipcRenderer.removeListener(IPC.profile.onChanged, listener)
  }
}

const onboardingApi = {
  getStatus: (): Promise<OnboardingStatus> => ipcRenderer.invoke(IPC.onboarding.getStatus),
  setStorageMode: (mode: StorageMode): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.onboarding.setStorageMode, { mode }),
  complete: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.onboarding.complete),
  detectMcpConfigs: (): Promise<McpConfigDetection[]> => ipcRenderer.invoke(IPC.onboarding.detectMcpConfigs),
  getMcpSnippet: (cli: McpCliId, scope: McpScope): Promise<string> =>
    ipcRenderer.invoke(IPC.onboarding.getMcpSnippet, { cli, scope }),
  autoConfigureMcp: (cli: McpCliId, scope: McpScope): Promise<McpAutoConfigureResult> =>
    ipcRenderer.invoke(IPC.onboarding.autoConfigureMcp, { cli, scope }),
  verifyMcpConnection: (): Promise<McpVerifyResult> => ipcRenderer.invoke(IPC.onboarding.verifyMcpConnection)
}

const browserControlApi = {
  resumeTask: (taskId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.browserControl.resumeTask, { taskId }),
  cancelTask: (taskId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.browserControl.cancelTask, { taskId }),
  onCaptchaDetected: (callback: (payload: CaptchaDetectedPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CaptchaDetectedPayload): void => callback(payload)
    ipcRenderer.on(IPC.browserControl.onCaptchaDetected, listener)
    return () => ipcRenderer.removeListener(IPC.browserControl.onCaptchaDetected, listener)
  },
  onCaptchaResolved: (callback: (payload: CaptchaResolvedPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CaptchaResolvedPayload): void => callback(payload)
    ipcRenderer.on(IPC.browserControl.onCaptchaResolved, listener)
    return () => ipcRenderer.removeListener(IPC.browserControl.onCaptchaResolved, listener)
  }
}

const browserSetupApi = {
  retryDownload: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.browserSetup.retryDownload),
  respondInstall: (accept: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.browserSetup.respondInstall, { accept }),
  getPreference: (): Promise<BrowserPreference> => ipcRenderer.invoke(IPC.browserSetup.getPreference),
  setPreference: (preference: BrowserPreference): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.browserSetup.setPreference, { preference }),
  getStatus: (): Promise<ResolvedBrowserStatus> => ipcRenderer.invoke(IPC.browserSetup.getStatus),
  onProgress: (callback: (payload: BrowserDownloadProgressPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BrowserDownloadProgressPayload): void =>
      callback(payload)
    ipcRenderer.on(IPC.browserSetup.onProgress, listener)
    return () => ipcRenderer.removeListener(IPC.browserSetup.onProgress, listener)
  },
  onStatus: (callback: (payload: BrowserSetupStatusPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BrowserSetupStatusPayload): void =>
      callback(payload)
    ipcRenderer.on(IPC.browserSetup.onStatus, listener)
    return () => ipcRenderer.removeListener(IPC.browserSetup.onStatus, listener)
  }
}

const settingsApi = {
  changeStorageMode: (mode: StorageMode): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.settings.changeStorageMode, { mode }),
  getAutoStartCommand: (): Promise<AutoStartCommand> => ipcRenderer.invoke(IPC.settings.getAutoStartCommand),
  setAutoStartCommand: (
    command: AutoStartCommand
  ): Promise<{ ok: boolean; command?: AutoStartCommand; error?: string }> =>
    ipcRenderer.invoke(IPC.settings.setAutoStartCommand, { command }),
  getStorageStats: (): Promise<StorageStats> => ipcRenderer.invoke(IPC.settings.getStorageStats),
  getAdvanced: (): Promise<AdvancedSettingsSnapshot> => ipcRenderer.invoke(IPC.settings.getAdvanced),
  updateAdvanced: (
    key: ApplyerSettingKey,
    value: unknown
  ): Promise<{ ok: true; snapshot: AdvancedSettingsSnapshot } | { ok: false; error: AppError }> =>
    ipcRenderer.invoke(IPC.settings.updateAdvanced, { key, value }),
  resetAdvanced: (
    key: ApplyerSettingKey
  ): Promise<{ ok: true; snapshot: AdvancedSettingsSnapshot } | { ok: false; error: AppError }> =>
    ipcRenderer.invoke(IPC.settings.resetAdvanced, { key }),
  getNotificationPreferences: (): Promise<NotificationPreferences> =>
    ipcRenderer.invoke(IPC.settings.getNotificationPreferences),
  setNotificationPreferences: (
    preferences: NotificationPreferences
  ): Promise<{ ok: boolean; preferences?: NotificationPreferences; error?: AppError }> =>
    ipcRenderer.invoke(IPC.settings.setNotificationPreferences, { preferences }),
  testNotification: (kind: NotificationTestKind): Promise<{ ok: boolean; error?: AppError }> =>
    ipcRenderer.invoke(IPC.settings.testNotification, { kind }),
  setNotificationLocale: (locale: NotificationLocale): Promise<{ ok: boolean; error?: AppError }> =>
    ipcRenderer.invoke(IPC.settings.setNotificationLocale, { locale })
}

const storageLocationApi = {
  getStatus: (): Promise<StorageLocationStatus> => ipcRenderer.invoke(IPC.storageLocation.getStatus),
  pickFolder: (labels: DialogLabels): Promise<StorageLocationPickResult> =>
    ipcRenderer.invoke(IPC.storageLocation.pickFolder, { labels }),
  validate: (path: string): Promise<StorageLocationValidation> =>
    ipcRenderer.invoke(IPC.storageLocation.validate, { path }),
  migrate: (path: string): Promise<StorageLocationMigrationResult> =>
    ipcRenderer.invoke(IPC.storageLocation.migrate, { path }),
  connectExisting: (path: string): Promise<StorageLocationMigrationResult> =>
    ipcRenderer.invoke(IPC.storageLocation.connectExisting, { path }),
  retryCustomLocation: (): Promise<StorageLocationMigrationResult> =>
    ipcRenderer.invoke(IPC.storageLocation.retryCustomLocation),
  useDefaultLocation: (): Promise<StorageLocationMigrationResult> =>
    ipcRenderer.invoke(IPC.storageLocation.useDefaultLocation),
  onProgress: (callback: (payload: StorageLocationProgressPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: StorageLocationProgressPayload): void =>
      callback(payload)
    ipcRenderer.on(IPC.storageLocation.onProgress, listener)
    return () => ipcRenderer.removeListener(IPC.storageLocation.onProgress, listener)
  }
}

const logsApi = {
  list: (query: ListActivityQuery): Promise<ListActivityResult> => ipcRenderer.invoke(IPC.logs.list, query)
}

const appApi = {
  getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.app.getInfo)
}

const dataApi = {
  exportJson: (selection: ExportSelection, labels: DialogLabels, theme: ThemeState): Promise<ExportFileResult> =>
    ipcRenderer.invoke(IPC.data.exportJson, { selection, labels, theme }),
  exportCsv: (table: CsvTable, labels: DialogLabels): Promise<ExportFileResult> =>
    ipcRenderer.invoke(IPC.data.exportCsv, { table, labels }),
  getExportSizes: (theme: ThemeState): Promise<ExportSizes> =>
    ipcRenderer.invoke(IPC.data.getExportSizes, { theme }),
  pickImportFile: (labels: DialogLabels): Promise<ImportPickResult> =>
    ipcRenderer.invoke(IPC.data.pickImportFile, { labels }),
  import: (bundle: ExportBundle, selection: ExportSelection): Promise<ImportApplyResult> =>
    ipcRenderer.invoke(IPC.data.import, { bundle, selection })
}

const clipboardApi = {
  readText: (): Promise<string> => ipcRenderer.invoke(IPC.clipboard.readText),
  writeText: (text: string): void => ipcRenderer.send(IPC.clipboard.writeText, text)
}

const api = {
  terminal: terminalApi,
  clipboard: clipboardApi,
  jobs: jobsApi,
  indexedJobs: indexedJobsApi,
  companyBoards: companyBoardsApi,
  exclusions: exclusionsApi,
  profile: profileApi,
  onboarding: onboardingApi,
  browserControl: browserControlApi,
  browserSetup: browserSetupApi,
  settings: settingsApi,
  storageLocation: storageLocationApi,
  logs: logsApi,
  app: appApi,
  data: dataApi
}

contextBridge.exposeInMainWorld('api', api)

export type ApplyerApi = typeof api
