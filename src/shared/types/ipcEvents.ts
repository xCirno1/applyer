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
    markSubmitted: 'jobs:markSubmitted',
    retry: 'jobs:retry',
    retryAll: 'jobs:retryAll',
    retryMany: 'jobs:retryMany',
    remove: 'jobs:remove',
    exclude: 'jobs:exclude',
    excludeMany: 'jobs:excludeMany',
    onUpdated: 'jobs:updated',
    onRemoved: 'jobs:removed'
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
  settings: {
    changeStorageMode: 'settings:changeStorageMode',
    getAutoStartCommand: 'settings:getAutoStartCommand',
    setAutoStartCommand: 'settings:setAutoStartCommand'
  },
  logs: {
    list: 'logs:list'
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
 * Shell command line to type into a freshly opened terminal session, e.g.
 * `claude`, `codex`, or any other agent CLI the user has installed
 * (`aider`, `opencode --model ...`, etc). Empty string means disabled.
 */
export type AutoStartCommand = string

export interface McpConfigDetection {
  cli: McpCliId
  configPath: string
  exists: boolean
  alreadyConfigured: boolean
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
