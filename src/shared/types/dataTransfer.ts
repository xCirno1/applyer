import type { JobRecord } from './job'
import type { ExclusionRecord } from './exclusion'
import type { ProfileFields } from './profile'
import type { AutoStartCommand } from './ipcEvents'
import type { IndexedJobsRetention } from './indexedJob'
import type { AtsProvider } from './companyBoard'
import type { AppError } from './errorCodes'
import type { NotificationPreferences } from './notification'
import type { SearchCountry } from './jobSource'
import type { ThemeState } from './theme'
import type { ResumeContent, ResumePageSize, ResumeSettings, ResumeTemplateId, ResumeStyle } from './resume'
import type { AgentMode } from './agentMode'
import type { OpenRouterSettings } from './openrouter'
import type { ChatMessage } from './chat'

/**
 * Bumped whenever the export bundle shape changes in a way older imports can't
 * read. Adding a domain isn't such a change in either direction: every key
 * under `data` is optional, so an older bundle simply has none of the new
 * domain, and an older build reading a newer bundle drops the key it doesn't
 * know rather than rejecting the file.
 */
export const EXPORT_SCHEMA_VERSION = 1

export type ExportDomain =
  | 'jobs'
  | 'indexedJobs'
  | 'exclusions'
  | 'companyBoards'
  | 'profile'
  | 'resumes'
  | 'settings'
  | 'theme'
  | 'chats'

export const ALL_EXPORT_DOMAINS: ExportDomain[] = [
  'jobs',
  'indexedJobs',
  'exclusions',
  'companyBoards',
  'profile',
  'resumes',
  'settings',
  'theme',
  'chats'
]

export type ExportSelection = Record<ExportDomain, boolean>

export function allDomainsSelected(value = true): ExportSelection {
  return {
    jobs: value,
    indexedJobs: value,
    exclusions: value,
    companyBoards: value,
    profile: value,
    resumes: value,
    settings: value,
    theme: value,
    chats: value
  }
}

export interface ExportSettingsData {
  autoStartCommand: AutoStartCommand
  indexedJobsRetentionDays: IndexedJobsRetention
  /** Optional so bundles written before notification settings existed remain valid. */
  notificationPreferences?: NotificationPreferences
  /** Optional for the same reason: bundles written before the job search country existed. */
  searchCountry?: SearchCountry
  /** Optional for the same reason: bundles written before OpenRouter agent mode existed. */
  agentMode?: AgentMode
  /**
   * The API key is NEVER exported (it lives only in the OS keychain, or as an
   * explicit plaintext opt-in that a bundle must not carry). Only the
   * non-secret picks: which model, how much reasoning, and which tools ask
   * for inline approval.
   */
  openrouter?: Pick<OpenRouterSettings, 'modelId' | 'reasoningEffort' | 'toolApproval'>
}

/** The single JSON round-trip format — the only format `data:import` accepts. */
export interface ExportBundle {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  appVersion: string
  data: {
    jobs?: ExportJobRecord[]
    indexedJobs?: ExportIndexedJob[]
    exclusions?: ExclusionRecord[]
    companyBoards?: ExportCompanyBoard[]
    profile?: ProfileFields | null
    resumes?: ExportResumesData
    settings?: ExportSettingsData
    /** Optional so bundles written before OpenRouter chat sessions existed remain valid. */
    chats?: ExportChatSession[]
    /**
     * Unlike every other domain, never read or written by the main process —
     * it lives in the renderer's localStorage (see renderer/src/theme/theme.ts),
     * so main only carries it through unread between the renderer's export
     * call and, on import, the renderer applying it back via
     * `ThemeContext.importTheme`.
     */
    theme?: ThemeState
  }
}

/**
 * A job as exported: the record plus the *name* of the resume variant it
 * uses, since ids are minted afresh on import and the name is what a
 * variant is known by. Resolved after both domains are imported (see
 * `applyImport`); a name that matches nothing is counted, not an error.
 * Optional so bundles written before named variants existed remain valid.
 */
export interface ExportJobRecord extends JobRecord {
  resumeVariantName?: string | null
}

/**
 * The structured master resume and its named variants. Timestamps are left
 * out: the importing side stamps its own, and a variant is written against
 * the imported master so none arrives stale. Which jobs use a variant
 * travels with the jobs (`ExportJobRecord.resumeVariantName`), so a variant
 * imports fine with no jobs at all. The attachment settings (what a job with
 * no variant attaches, whether the agent tailors on its own) ride along here
 * rather than in the settings domain: they only mean something next to the
 * resumes they govern, and a restore that brought the master back but
 * quietly went back to attaching the original upload would be a surprise.
 * Optional so bundles written before they were exported remain valid.
 */
export interface ExportResumesData {
  master: { content: ResumeContent; templateId: ResumeTemplateId; pageSize: ResumePageSize; style?: ResumeStyle } | null
  variants: Array<{ name: string; content: ResumeContent; templateId: ResumeTemplateId }>
  settings?: ResumeSettings
}

/**
 * A tracked board, reduced to what actually identifies it.
 *
 * The live columns — `lastCheckedAt`, `lastJobCount`, `lastError` — are
 * deliberately left out: they describe what *this* machine saw the last time
 * it fetched the board, and carrying "12 open roles" into another install
 * would present a stale reading as a current one. The importing side starts
 * every board unchecked and the first search fills them in.
 *
 * `boardKey` is left out too, since it is derived from the descriptor and is
 * recomputed on import — a hand-edited file must not be able to file a board
 * under a key that doesn't match its own provider and token.
 */
export interface ExportCompanyBoard {
  provider: AtsProvider
  token: string
  host: string | null
  site: string | null
  companyName: string
  addedBy: 'user' | 'agent'
  enabled: boolean
  /**
   * The one count that does travel, because it isn't a reading: it is what
   * the feed the board was imported from claimed, and it orders the
   * importing machine's first sweeps exactly as it ordered this one's.
   * Optional so a bundle written before this field parses unchanged.
   */
  seedJobCount?: number | null
  createdAt: string
}

/**
 * Every job a search has ever surfaced, matched or not — the record of what
 * job discovery actually saw, which `jobs` (only what the agent chose to
 * queue) does not contain. Without this domain, moving an install or
 * restoring a backup silently drops the entire search history, and re-running
 * the same searches would re-index every row as newly seen.
 *
 * `id` is left out and regenerated on import, for the same reason it is for
 * exclusions: the row's identity is its URL, which is what the merge is keyed
 * on. The match columns (`matchedJobId`/`matchedStatus`/`matchedScore`) are
 * left out because they are not stored at all — they are derived at read time
 * by joining the jobs table, so exporting them would ship a snapshot of a
 * join that the importing machine recomputes for itself.
 */
export interface ExportIndexedJob {
  url: string
  title: string
  company: string
  location: string | null
  source: string | null
  snippet: string | null
  salaryRange: string | null
  postedAt: string | null
  searchQuery: string
  searchLocation: string | null
  firstSeenAt: string
  lastSeenAt: string
  seenCount: number
}

/**
 * A chat session as exported: the conversation content, with none of the
 * per-install identity (`id`, `busy`, `totalCostUsd` is re-derived from the
 * imported messages' `usage`) that a fresh import would need to regenerate
 * anyway. Messages keep only the fields another install's UI actually
 * renders; `toolCallId` travels so a `tool` message still resolves back to
 * the assistant tool call it answered after ids are re-minted on import.
 */
export interface ExportChatSession {
  title: string
  modelId: string
  createdAt: string
  messages: Array<
    Pick<ChatMessage, 'role' | 'content' | 'reasoning' | 'toolCalls' | 'toolCallId' | 'modelId' | 'usage' | 'createdAt'>
  >
}

/** CSV is export-only (a single flat table), never a round-trip import source. */
export type CsvTable = 'jobs' | 'indexedJobs' | 'exclusions' | 'companyBoards'

/**
 * Byte sizes for the Export modal's per-section preview, computed
 * independent of the current checkbox selection so toggling a checkbox
 * doesn't need a round trip. `csv` is only meaningful for the two tabular
 * domains — CSV export never bundles profile/settings.
 */
export interface ExportSizes {
  jobs: { json: number; csv: number }
  indexedJobs: { json: number; csv: number }
  exclusions: { json: number; csv: number }
  companyBoards: { json: number; csv: number }
  profile: { json: number }
  resumes: { json: number }
  settings: { json: number }
  theme: { json: number }
  chats: { json: number }
  /** Fixed bytes of the bundle wrapper itself (schemaVersion/exportedAt/appVersion/`data: {}`) — present once whenever any domain is included in a JSON export, on top of the per-domain sizes above. */
  wrapperBytes: number
}

/**
 * Total bytes of a compact JSON export bundle containing exactly the
 * selected domains. Not simply `wrapperBytes + sum(domain sizes)` — compact
 * `JSON.stringify` inserts a `,` between each key present in `data`, so N
 * selected domains need N-1 extra separator bytes beyond their individually
 * measured marginal sizes.
 *
 * Every domain in `ALL_EXPORT_DOMAINS` now has a required entry in `sizes`
 * (main always computes all of them), but the `sizes[d] !== undefined` guard
 * stays here defensively: a domain missing from `sizes` is excluded from N
 * entirely, not counted as a zero-byte domain, since main only ever writes a
 * `data` key for a domain it actually sized and counting an unsized one
 * would add a phantom separator byte the real bundle never has.
 */
export function totalJsonBytes(sizes: ExportSizes, selection: ExportSelection): number {
  const domains = ALL_EXPORT_DOMAINS.filter((d) => selection[d] && sizes[d] !== undefined)
  if (domains.length === 0) return 0
  const sum = domains.reduce((total, d) => total + (sizes[d]?.json ?? 0), 0)
  return sizes.wrapperBytes + sum + (domains.length - 1)
}

export interface ExportFileResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: AppError
}

export interface ImportDomainCounts {
  jobs?: number
  indexedJobs?: number
  exclusions?: number
  companyBoards?: number
  profile?: number
  /** Master (1 or 0) plus variants. */
  resumes?: number
  settings?: number
  theme?: number
  chats?: number
}

export interface ImportPickResult {
  ok: boolean
  canceled?: boolean
  error?: AppError
  filePath?: string
  bundle?: ExportBundle
  counts?: ImportDomainCounts
}

export interface ImportSummary {
  jobs?: { imported: number; skipped: number }
  /** `skipped` is a URL already indexed here: the merge keeps this machine's own seen-counts rather than overwriting them. */
  indexedJobs?: { imported: number; skipped: number }
  exclusions?: { imported: number; skipped: number }
  /** `skipped` covers both an already-tracked board and one refused by the watchlist ceiling. */
  companyBoards?: { imported: number; skipped: number }
  profile?: boolean
  /** `imported` counts the master (if any) plus variants; `skipped` is variants that could not be written (no master to base them on). */
  resumes?: { imported: number; skipped: number }
  /** The attachment settings that ride with the resumes domain were applied (the agent's instruction file depends on one of them). */
  resumeSettings?: boolean
  /**
   * Job → variant assignments re-created from the jobs' `resumeVariantName`,
   * present whenever the jobs domain was imported and any job named one.
   * `unresolved` is a name no variant here has (the resumes domain was not
   * selected, or the variant was deleted before the export).
   */
  resumeAssignments?: { linked: number; unresolved: number }
  settings?: boolean
  /** `skipped` is a session whose model or content failed validation. */
  chats?: { imported: number; skipped: number }
  // No `theme` here: `applyImport` (main process) never touches that domain
  // — it's the renderer that reads `bundle.data.theme` off the same
  // `ImportApplyResult` and applies it via `ThemeContext.importTheme` once
  // this summary comes back ok.
}

export interface ImportApplyResult {
  ok: boolean
  error?: AppError
  summary?: ImportSummary
}
