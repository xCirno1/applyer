import { newHeadlessContext } from './browserController'
import { getMasterResume, getVariantByJob } from '../db/repositories/resumeRepository'
import { getResumeSettings } from '../db/repositories/settingsRepository'
import { renderResumeHtml } from '@shared/resume/templates'
import type { ResumeContent, ResumePageSize, ResumeTemplateId, ResumeStyle } from '@shared/types/resume'

/*
 * Turns resume content into PDF bytes with the bundled headless Chromium.
 *
 * Always a fresh headless context, never the fill session's page: that page
 * may be a visible window, or a tab in the user's own browser attached over
 * remote debugging, and `page.pdf()` only works in headless Chromium. The
 * headless browser is the same one job search uses, so a render can block on
 * the first-run download confirmation the same way a search does.
 *
 * Nothing is fetched: templates inline all CSS and use system fonts, so the
 * document is complete after `setContent` and the network guard the context
 * carries never sees a request.
 */

const PDF_FORMAT: Record<ResumePageSize, 'Letter' | 'A4'> = { letter: 'Letter', a4: 'A4' }

export async function renderResumePdf(
  content: ResumeContent,
  templateId: ResumeTemplateId,
  pageSize: ResumePageSize,
  style: ResumeStyle = {}
): Promise<Buffer> {
  const html = renderResumeHtml(content, templateId, pageSize, style)
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    // `@page` in the template already sets size and margins; `preferCSSPageSize`
    // makes Chromium honour them so the PDF matches the preview frame.
    return await page.pdf({ format: PDF_FORMAT[pageSize], printBackground: true, preferCSSPageSize: true })
  } finally {
    await context.close().catch(() => {
      // The browser may already be gone; there is nothing left to release.
    })
  }
}

export type ResumeAttachmentPlan =
  | {
      kind: 'variant'
      /** The variant's user-facing name, for the activity log. */
      name: string
      content: ResumeContent
      templateId: ResumeTemplateId
      pageSize: ResumePageSize
      style: ResumeStyle
      stale: boolean
    }
  | { kind: 'master'; content: ResumeContent; templateId: ResumeTemplateId; pageSize: ResumePageSize; style: ResumeStyle }
  | { kind: 'original' }

/**
 * Which resume a job gets: the variant assigned to it when there is one,
 * otherwise the master when the user chose that fallback, otherwise the uploaded file
 * (which may itself be absent; the caller finds that out from the documents
 * table, as it always has). A corrupt payload throws rather than silently
 * dropping to the original: attaching the wrong resume is worse than a
 * skipped field.
 */
export function resolveResumeAttachment(jobId: string): ResumeAttachmentPlan {
  const master = getMasterResume()
  if (!master) return { kind: 'original' }
  const variant = getVariantByJob(jobId)
  if (variant) {
    return {
      kind: 'variant',
      name: variant.name,
      content: variant.content,
      templateId: variant.templateId,
      pageSize: master.pageSize,
      style: master.style,
      stale: variant.basedOnMasterUpdatedAt < master.updatedAt
    }
  }
  if (getResumeSettings().fallbackAttachment === 'master') {
    return {
      kind: 'master',
      content: master.content,
      templateId: master.templateId,
      pageSize: master.pageSize,
      style: master.style
    }
  }
  return { kind: 'original' }
}

/**
 * The file name the form (and so the recruiter) sees. Built from the
 * resume's own name so it looks like something a person would upload, with
 * anything a filesystem or an ATS might choke on replaced.
 */
export function resumeFileName(content: ResumeContent): string {
  const base = content.header.fullName
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return base ? `${base} - Resume.pdf` : 'Resume.pdf'
}
