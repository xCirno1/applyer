import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
import { appError, type AppError } from '@shared/types/errorCodes'
import type { DialogLabels } from '@shared/types/ipcEvents'
import type { JobRecord } from '@shared/types/job'
import {
  DEFAULT_RESUME_SETTINGS,
  type MasterResume,
  type ResumeContent,
  type ResumePageSize,
  type ResumeSettings,
  type ResumeTemplateId,
  type ResumeVariant,
  type ResumeVariantSummary,
  type ResumeStyle
} from '@shared/types/resume'

/*
 * Renderer-side state for the Resume Variants screen, the job-card
 * indicator and the job detail modal's resume block.
 *
 * The variant *list* is summaries only (no content), refetched whole on every
 * `resumes:changed` signal; it carries which jobs use each variant, and
 * `variantIdByJob` is that relation turned around so a card or the modal can
 * find its job's variant without scanning. Variant *content* is loaded by id
 * on demand and cached in `variantsById`, since every entry carries a full
 * resume and the list page only ever shows one at a time. A signal drops the
 * cache, so an agent write while a variant is on screen shows up on the next
 * render rather than after a restart.
 *
 * Like `profileStore`, this has two writers (the page and the agent's MCP
 * tools), so `subscribeToUpdates` is wired from `App`'s `MainShell`, not from
 * the page: the page is mounted-but-hidden while another screen is showing
 * and would otherwise miss writes landing in the meantime.
 */

export type VariantWithState = ResumeVariant & { stale: boolean }

type WriteResult<T> = { ok: true; value: T } | { ok: false; error: AppError }

const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

export interface SaveVariantInput {
  id?: string
  name: string
  /** Optional on an update (`id` given): a rename or template change keeps the stored content. */
  content?: ResumeContent
  templateId?: ResumeTemplateId
}

interface ResumesState {
  master: MasterResume | null
  settings: ResumeSettings
  variants: ResumeVariantSummary[]
  variantIdByJob: Map<string, string>
  variantsById: Record<string, VariantWithState | null>
  loading: boolean
  loadedOnce: boolean
  /** The variant the Resume Variants page is showing; set from the job detail modal's "Open" too. */
  selectedVariantId: string | null

  fetch: () => Promise<void>
  select: (variantId: string | null) => void
  loadVariant: (variantId: string) => Promise<VariantWithState | null>
  saveMaster: (input: {
    content: ResumeContent
    templateId?: ResumeTemplateId
    pageSize?: ResumePageSize
    style?: ResumeStyle
    sourceDocumentId?: string | null
  }) => Promise<WriteResult<MasterResume>>
  deleteMaster: () => Promise<WriteResult<null>>
  saveVariant: (input: SaveVariantInput) => Promise<WriteResult<VariantWithState>>
  deleteVariant: (variantId: string) => Promise<WriteResult<{ unassignedJobs: number }>>
  assignVariant: (jobId: string, variantId: string | null) => Promise<WriteResult<JobRecord>>
  exportPdf: (
    target: { kind: 'master' } | { kind: 'variant'; id: string },
    labels: DialogLabels
  ) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: AppError }>
  setSettings: (settings: ResumeSettings) => Promise<WriteResult<ResumeSettings>>
  subscribeToUpdates: () => () => void
}

/** Drops anything that is not a summary with the fields the UI reads, so a malformed list cannot break every card. */
function sanitizeSummaries(value: unknown): ResumeVariantSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is ResumeVariantSummary =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ResumeVariantSummary).id === 'string' &&
      typeof (item as ResumeVariantSummary).name === 'string' &&
      Array.isArray((item as ResumeVariantSummary).jobs)
  )
}

export function indexVariantsByJob(variants: ResumeVariantSummary[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const variant of variants) {
    for (const job of variant.jobs) map.set(job.id, variant.id)
  }
  return map
}

export const useResumesStore = create<ResumesState>((set, get) => ({
  master: null,
  settings: DEFAULT_RESUME_SETTINGS,
  variants: [],
  variantIdByJob: new Map(),
  variantsById: {},
  loading: false,
  loadedOnce: false,
  selectedVariantId: null,

  fetch: async () => {
    set({ loading: true })
    // Three reads, one loading flag: the page needs all three before it can
    // say anything useful, and each falls back independently so a corrupt
    // master (which throws by design, like the profile) still leaves the
    // variant list and settings usable.
    const [masterResult, variantsResult, settingsResult] = await Promise.all([
      callIpc('resumes.getMaster', () => window.api.resumes.getMaster(), { master: null }),
      callIpc('resumes.listVariants', () => window.api.resumes.listVariants(), { variants: [] }),
      callIpc('resumes.getSettings', () => window.api.resumes.getSettings(), { settings: DEFAULT_RESUME_SETTINGS })
    ])
    const variants = sanitizeSummaries(variantsResult.variants)
    set({
      master: masterResult.master ?? null,
      variants,
      variantIdByJob: indexVariantsByJob(variants),
      settings: settingsResult.settings ?? DEFAULT_RESUME_SETTINGS,
      // Content may have changed under any cached variant; a signal is the
      // only thing that calls fetch besides mount, so drop the cache.
      variantsById: {},
      loading: false,
      loadedOnce: true
    })
  },

  select: (variantId) => set({ selectedVariantId: variantId }),

  loadVariant: async (variantId) => {
    const cached = get().variantsById[variantId]
    if (cached !== undefined) return cached
    const result = await callIpc('resumes.getVariant', () => window.api.resumes.getVariant(variantId), { variant: null })
    const variant = result.variant ?? null
    set({ variantsById: { ...get().variantsById, [variantId]: variant } })
    return variant
  },

  saveMaster: async (input) => {
    const result = await callIpc('resumes.saveMaster', () => window.api.resumes.saveMaster(input), BRIDGE_FAILURE)
    if (result.ok) {
      // The broadcast will refetch too; applying locally first means the
      // preview updates on the same frame as the Save button settles.
      set({ master: result.value })
    }
    return result
  },

  deleteMaster: async () => {
    const result = await callIpc('resumes.deleteMaster', () => window.api.resumes.deleteMaster(), BRIDGE_FAILURE)
    if (result.ok) {
      set({ master: null, variants: [], variantIdByJob: new Map(), variantsById: {}, selectedVariantId: null })
    }
    return result
  },

  saveVariant: async (input) => {
    const result = await callIpc('resumes.saveVariant', () => window.api.resumes.saveVariant(input), BRIDGE_FAILURE)
    if (result.ok) {
      const saved = result.value
      // Patch the summary in place (or add one) so the list row renames on
      // the same frame; the broadcast's refetch brings the job links.
      const existing = get().variants.find((variant) => variant.id === saved.id)
      const summary: ResumeVariantSummary = {
        id: saved.id,
        name: saved.name,
        templateId: saved.templateId,
        updatedAt: saved.updatedAt,
        stale: saved.stale,
        jobCount: existing?.jobCount ?? 0,
        jobs: existing?.jobs ?? []
      }
      const variants = existing
        ? get().variants.map((variant) => (variant.id === saved.id ? summary : variant))
        : [...get().variants, summary]
      set({ variants, variantsById: { ...get().variantsById, [saved.id]: saved } })
    }
    return result
  },

  deleteVariant: async (variantId) => {
    const result = await callIpc('resumes.deleteVariant', () => window.api.resumes.deleteVariant(variantId), BRIDGE_FAILURE)
    if (result.ok) {
      const variants = get().variants.filter((variant) => variant.id !== variantId)
      const variantsById = { ...get().variantsById }
      delete variantsById[variantId]
      set({
        variants,
        variantIdByJob: indexVariantsByJob(variants),
        variantsById,
        selectedVariantId: get().selectedVariantId === variantId ? null : get().selectedVariantId
      })
    }
    return result
  },

  assignVariant: async (jobId, variantId) => {
    const result = await callIpc(
      'resumes.assignVariant',
      () => window.api.resumes.assignVariant(jobId, variantId),
      BRIDGE_FAILURE
    )
    if (result.ok) {
      // Move the job between summaries locally so the modal's picker and the
      // card's tag settle with the request rather than after the refetch.
      const job = result.value
      const link = { id: job.id, title: job.title, company: job.company, status: job.status }
      const variants = get().variants.map((variant) => {
        const jobs = variant.jobs.filter((item) => item.id !== jobId)
        if (variant.id === variantId) jobs.unshift(link)
        return jobs.length === variant.jobs.length && variant.id !== variantId
          ? variant
          : { ...variant, jobs, jobCount: jobs.length }
      })
      set({ variants, variantIdByJob: indexVariantsByJob(variants) })
    }
    return result
  },

  exportPdf: (target, labels) =>
    callIpc('resumes.exportPdf', () => window.api.resumes.exportPdf(target, labels), BRIDGE_FAILURE),

  setSettings: async (settings) => {
    const result = await callIpc('resumes.setSettings', () => window.api.resumes.setSettings(settings), BRIDGE_FAILURE)
    if (result.ok) set({ settings: result.value })
    return result
  },

  subscribeToUpdates: () => window.api.resumes.onChanged(() => void get().fetch())
}))
