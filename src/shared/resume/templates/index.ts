import type { ResumeContent, ResumePageSize, ResumeStyle, ResumeTemplateId } from '../../types/resume'
import { classicTemplate } from './classic'
import { compactTemplate } from './compact'
import { modernTemplate } from './modern'
import type { ResumeTemplate } from './shared'

export { PAGE_DIMENSIONS_IN, PAGE_MARGIN_IN, type ResumeTemplate } from './shared'

export const RESUME_TEMPLATES: Record<ResumeTemplateId, ResumeTemplate> = {
  classic: classicTemplate,
  compact: compactTemplate,
  modern: modernTemplate
}

/**
 * The one entry point for turning content into a document. Main renders this
 * to PDF with headless Chromium; the renderer shows the identical string in a
 * sandboxed frame, which is what makes the preview trustworthy.
 */
export function renderResumeHtml(
  content: ResumeContent,
  templateId: ResumeTemplateId,
  pageSize: ResumePageSize,
  style?: ResumeStyle
): string {
  return RESUME_TEMPLATES[templateId].render(content, pageSize, style)
}
