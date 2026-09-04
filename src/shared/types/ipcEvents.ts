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
  companyBoards: {
    list: 'companyBoards:list',
    add: 'companyBoards:add',
    remove: 'companyBoards:remove',
    setEnabled: 'companyBoards:setEnabled',
    // Bulk forms of the row actions, for a multi-row selection.
    setEnabledMany: 'companyBoards:setEnabledMany',
    removeMany: 'companyBoards:removeMany',
    /** Fetch tracked boards on demand, outside a search, to fill in their last result. */
    fetch: 'companyBoards:fetch',
    /** One board's fetch landing, pushed as it happens rather than with the batch it belongs to. */
    onFetched: 'companyBoards:fetched',
    // Bulk import: pick and parse a CSV, plan what a column mapping would add, then write it.
    pickCsv: 'companyBoards:pickCsv',
    planCsv: 'companyBoards:planCsv',
    importCsv: 'companyBoards:importCsv',
    releaseCsv: 'companyBoards:releaseCsv',
    onChanged: 'companyBoards:changed'
  },
  exclusions: {
    list: 'exclusions:list',
    add: 'exclusions:add',
    remove: 'exclusions:remove',
    onChanged: 'exclusions:changed'
  },
  profile: {
    get: 'profile:get',
    save: 'profile:save',
    uploadDocument: 'profile:uploadDocument',
    deleteDocument: 'profile:deleteDocument',
    onChanged: 'profile:changed'
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
    respondInstall: 'browserSetup:respondInstall',
    getPreference: 'browserSetup:getPreference',
    setPreference: 'browserSetup:setPreference',
    getStatus: 'browserSetup:getStatus',
    onProgress: 'browserSetup:progress',
    onStatus: 'browserSetup:status'
  },
  settings: {
    changeStorageMode: 'settings:changeStorageMode',
    getAutoStartCommand: 'settings:getAutoStartCommand',
    setAutoStartCommand: 'settings:setAutoStartCommand',
    getStorageStats: 'settings:getStorageStats',
    getAdvanced: 'settings:getAdvanced',
    updateAdvanced: 'settings:updateAdvanced',
    resetAdvanced: 'settings:resetAdvanced',
    getNotificationPreferences: 'settings:getNotificationPreferences',
    setNotificationPreferences: 'settings:setNotificationPreferences',
    setNotificationLocale: 'settings:setNotificationLocale',
    testNotification: 'settings:testNotification'
  },
  storageLocation: {
    getStatus: 'storageLocation:getStatus',
    pickFolder: 'storageLocation:pickFolder',
    validate: 'storageLocation:validate',
    migrate: 'storageLocation:migrate',
    connectExisting: 'storageLocation:connectExisting',
    retryCustomLocation: 'storageLocation:retryCustomLocation',
    useDefaultLocation: 'storageLocation:useDefaultLocation',
    onProgress: 'storageLocation:progress'
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
    getInfo: 'app:getInfo'
  },
  clipboard: {
    readText: 'clipboard:readText',
    writeText: 'clipboard:writeText'
  }
} as const

export interface AppInfo {
  version: string
  /**
   * True for an unpackaged (`npm run dev`) run, which uses its own
   * `…-dev` userData directory (see main/config/userDataDir.ts) — so the UI
   * can mark the window as looking at a different dataset than the
   * installed build.
   */
  isDevBuild: boolean
  /**
   * The per-install directory (`…/applyer` vs `…/applyer-dev`) — what
   * actually separates a dev run from the installed build. Deliberately not
   * the active storage root, which a migration can move at runtime: every
   * field here is fixed for the process lifetime, so the renderer can fetch
   * this once and cache it. Settings > Storage owns the live location.
   */
  userDataDir: string
}

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
  | { status: 'confirm' }
  | { status: 'downloading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

/**
 * `auto` (default) tries system Chrome, then system Edge, then falls back to a managed
 * download. The other three pin resolution to exactly one option — if it's unavailable,
 * launching fails with an explanatory error instead of silently trying something else,
 * since the user explicitly chose it.
 */
export type BrowserPreference = 'auto' | 'chrome' | 'msedge' | 'managed'

export type ResolvedBrowserKind = 'unresolved' | 'dev-bundled' | 'chrome' | 'msedge' | 'managed'

export interface ResolvedBrowserStatus {
  /** Whether this is a packaged build — the preference only affects resolution when true; a dev build always uses the bundled browser. */
  packaged: boolean
  /** 'unresolved' until the first browser launch actually happens (resolution is lazy). */
  kind: ResolvedBrowserKind
  /** Only known for 'dev-bundled'/'managed' — a system Chrome/Edge launch (via Playwright's `channel` option) doesn't expose its resolved binary path. */
  executablePath: string | null
}

/**
 * Labels for a native OS dialog, supplied by the renderer.
 *
 * Native dialogs are the one user-facing main-process surface that can't use
 * the error-code indirection: Electron wants finished strings, and main has
 * no locale. The renderer already knows the language, so it translates and
 * passes them down at call time.
 */
export interface DialogLabels {
  title: string
  /** Name shown next to the extension in the file-type filter (e.g. "JSON"). */
  filterName: string
}
