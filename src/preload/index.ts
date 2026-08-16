import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type TerminalCreateOptions,
  type TerminalCreateResult,
  type McpCliId,
  type McpConfigDetection,
  type McpAutoConfigureResult,
  type McpVerifyResult,
  type OnboardingStatus,
  type UploadDocumentRequest,
  type CaptchaDetectedPayload,
  type CaptchaResolvedPayload
} from '@shared/types/ipcEvents'
import type { JobRecord, ListJobsQuery, ListJobsResult } from '@shared/types/job'
import type { DocumentSummary, ProfileFields, ProfileWithDocuments, StorageMode } from '@shared/types/profile'
import type { ListActivityQuery, ListActivityResult } from '@shared/types/activity'

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
  markSubmitted: (jobId: string): Promise<{ ok: boolean; job?: JobRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.jobs.markSubmitted, { jobId }),
  retry: (jobId: string): Promise<{ ok: boolean; job?: JobRecord; error?: string }> =>
    ipcRenderer.invoke(IPC.jobs.retry, { jobId }),
  remove: (jobId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.jobs.remove, { jobId }),
  onUpdated: (callback: (job: JobRecord) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, job: JobRecord): void => callback(job)
    ipcRenderer.on(IPC.jobs.onUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.jobs.onUpdated, listener)
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
  getMcpSnippet: (cli: McpCliId): Promise<string> => ipcRenderer.invoke(IPC.onboarding.getMcpSnippet, { cli }),
  autoConfigureMcp: (cli: McpCliId): Promise<McpAutoConfigureResult> =>
    ipcRenderer.invoke(IPC.onboarding.autoConfigureMcp, { cli }),
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

const settingsApi = {
  changeStorageMode: (mode: StorageMode): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.settings.changeStorageMode, { mode })
}

const logsApi = {
  list: (query: ListActivityQuery): Promise<ListActivityResult> => ipcRenderer.invoke(IPC.logs.list, query)
}

const api = {
  terminal: terminalApi,
  jobs: jobsApi,
  profile: profileApi,
  onboarding: onboardingApi,
  browserControl: browserControlApi,
  settings: settingsApi,
  logs: logsApi
}

contextBridge.exposeInMainWorld('api', api)

export type ApplyerApi = typeof api
