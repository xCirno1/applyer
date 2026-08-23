/** Channel names shared between preload and renderer for typed IPC. */
export const IPC = {
  terminal: {
    create: 'terminal:create',
    write: 'terminal:write',
    resize: 'terminal:resize',
    dispose: 'terminal:dispose',
    onData: 'terminal:data',
    onExit: 'terminal:exit'
  },
  jobs: {
    list: 'jobs:list',
    get: 'jobs:get',
    markSubmitted: 'jobs:markSubmitted',
    retry: 'jobs:retry',
    retryAll: 'jobs:retryAll',
    retryMany: 'jobs:retryMany',
    remove: 'jobs:remove',
    exclude: 'jobs:exclude',
    excludeMany: 'jobs:excludeMany',
    unqueue: 'jobs:unqueue',
    unqueueMany: 'jobs:unqueueMany',
    onUpdated: 'jobs:updated',
    onRemoved: 'jobs:removed'
  },
  indexedJobs: {
    list: 'indexedJobs:list',
    getRetention: 'indexedJobs:getRetention',
    setRetention: 'indexedJobs:setRetention',
    onChanged: 'indexedJobs:changed'
  },
  exclusions: {
    list: 'exclusions:list',
    add: 'exclusions:add',
    remove: 'exclusions:remove'
  },
  profile: {
    get: 'profile:get',
    save: 'profile:save',
    uploadDocument: 'profile:uploadDocument',
    deleteDocument: 'profile:deleteDocument'
  },
  onboarding: {
    getStatus: 'onboarding:getStatus',
    setStorageMode: 'onboarding:setStorageMode',
    complete: 'onboarding:complete',
    detectMcpConfigs: 'onboarding:detectMcpConfigs',
    getMcpSnippet: 'onboarding:getMcpSnippet',
    autoConfigureMcp: 'onboarding:autoConfigureMcp',
    verifyMcpConnection: 'onboarding:verifyMcpConnection'
  },
  browserControl: {
    resumeTask: 'browser:resumeTask',
    cancelTask: 'browser:cancelTask',
    onCaptchaDetected: 'browser:captchaDetected',
    onCaptchaResolved: 'browser:captchaResolved'
  },
  browserSetup: {
    retryDownload: 'browserSetup:retryDownload',
    onProgress: 'browserSetup:progress',
    onStatus: 'browserSetup:status'
  },
  settings: {
    changeStorageMode: 'settings:changeStorageMode',
    getAutoStartCommand: 'settings:getAutoStartCommand',
    setAutoStartCommand: 'settings:setAutoStartCommand',
    getStorageStats: 'settings:getStorageStats'
  },
  logs: {
    list: 'logs:list'
  },
  data: {
    exportJson: 'data:exportJson',
    exportCsv: 'data:exportCsv',
    getExportSizes: 'data:getExportSizes',
    pickImportFile: 'data:pickImportFile',
    import: 'data:import'
  },
  app: {
    getVersion: 'app:getVersion'
  }
} as const

export interface TerminalCreateOptions {
  cols: number
  rows: number
}

export interface TerminalCreateResult {
  sessionId: string
}

export type McpCliId = 'claude' | 'codex'

/**
 * `user` writes to the CLI's global config (applies to every project the
 * CLI is run from); `workspace` scopes it to Applyer's own dedicated
 * terminal cwd (see `agentWorkspaceDir()`) so the server only shows up in
 * CLI sessions started from Applyer's terminal, not the user's other
 * projects. Not every CLI supports the latter — see `supportsWorkspaceScope`.
 */
export type McpScope = 'user' | 'workspace'

/**
 * Shell command line to type into a freshly opened terminal session, e.g.
 * `claude`, `codex`, or any other agent CLI the user has installed
 * (`aider`, `opencode --model ...`, etc). Empty string means disabled.
 */
export type AutoStartCommand = string

export interface McpConfigDetection {
  cli: McpCliId
  configPath: string
  exists: boolean
  supportsWorkspaceScope: boolean
  configuredScopes: McpScope[]
}

export interface McpAutoConfigureResult {
  success: boolean
  backupPath?: string
  error?: string
}

export interface McpVerifyResult {
  success: boolean
  tools?: string[]
  error?: string
}

export interface OnboardingStatus {
  completed: boolean
  storageMode: 'encrypted' | 'plaintext' | null
  encryptionAvailable: boolean
}

export interface UploadDocumentRequest {
  kind: 'resume' | 'cover_letter' | 'other'
  filename: string
  mimeType: string
  data: ArrayBuffer
}

export interface CaptchaDetectedPayload {
  taskId: string
  jobId: string
  jobTitle: string
  company: string
}

export interface CaptchaResolvedPayload {
  taskId: string
  jobId: string
}

export interface BrowserDownloadProgressPayload {
  percent: number
  totalSize: string
}

export type BrowserSetupStatusPayload =
  | { status: 'downloading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }
