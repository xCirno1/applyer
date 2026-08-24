import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
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
  type ResolvedBrowserStatus
} from '@shared/types/ipcEvents'
import type { JobRecord, ListJobsQuery, ListJobsResult } from '@shared/types/job'
import type { DocumentSummary, ProfileFields, ProfileWithDocuments, StorageMode } from '@shared/types/profile'
import type { ListActivityQuery, ListActivityResult } from '@shared/types/activity'
import type { ExclusionRecord, ListExclusionsQuery, ListExclusionsResult } from '@shared/types/exclusion'
import type { IndexedJobsRetention, ListIndexedJobsQuery, ListIndexedJobsResult } from '@shared/types/indexedJob'
import type { StorageStats } from '@shared/types/storage'
import type {
  ExportSelection,
  ExportSizes,
  CsvTable,
  ExportFileResult,
  ImportPickResult,
  ImportApplyResult,
  ExportBundle
} from '@shared/types/dataTransfer'

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
    ipcRenderer.invoke(IPC.profile.deleteDocument, { documentId })
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
  getStorageStats: (): Promise<StorageStats> => ipcRenderer.invoke(IPC.settings.getStorageStats)
}

const logsApi = {
  list: (query: ListActivityQuery): Promise<ListActivityResult> => ipcRenderer.invoke(IPC.logs.list, query)
}

const appApi = {
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.app.getVersion)
}

const dataApi = {
  exportJson: (selection: ExportSelection): Promise<ExportFileResult> =>
    ipcRenderer.invoke(IPC.data.exportJson, { selection }),
  exportCsv: (table: CsvTable): Promise<ExportFileResult> => ipcRenderer.invoke(IPC.data.exportCsv, { table }),
  getExportSizes: (): Promise<ExportSizes> => ipcRenderer.invoke(IPC.data.getExportSizes),
  pickImportFile: (): Promise<ImportPickResult> => ipcRenderer.invoke(IPC.data.pickImportFile),
  import: (bundle: ExportBundle, selection: ExportSelection): Promise<ImportApplyResult> =>
    ipcRenderer.invoke(IPC.data.import, { bundle, selection })
}

const api = {
  terminal: terminalApi,
  jobs: jobsApi,
  indexedJobs: indexedJobsApi,
  exclusions: exclusionsApi,
  profile: profileApi,
  onboarding: onboardingApi,
  browserControl: browserControlApi,
  browserSetup: browserSetupApi,
  settings: settingsApi,
  logs: logsApi,
  app: appApi,
  data: dataApi
}

contextBridge.exposeInMainWorld('api', api)

export type ApplyerApi = typeof api
