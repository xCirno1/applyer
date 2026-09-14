import { displayUrl, escapeHtml, safeHref } from '../escapeHtml'
import {
  RESUME_FONT_STACKS,
  type ResumeContent,
  type ResumeContact,
  type ResumeEntry,
  type ResumeGroup,
  type ResumePageSize,
  type ResumeSection,
  type ResumeStyle,
  type ResumeTemplateId
} from '../../types/resume'

/*
 * The parts every template shares: the document skeleton, the page-size
 * rules, and the four section layouts as HTML. A template is then mostly a
 * stylesheet plus a header arrangement, which is what keeps the three
 * built-ins consistent with each other (same class names, same escaping) and
 * makes a fourth cheap to add.
 *
 * Page geometry lives in CSS, not in Playwright's `page.pdf` options: the
 * preview frame in the app and the PDF must be the same document, and the
 * frame has no `page.pdf` options. `@page` sets the print size and margins;
 * on screen the body carries the same margin as padding so the preview shows
 * the sheet the way it will print. Templates do not override the margin:
 * the preview's paginator assumes `PAGE_MARGIN_IN` too, and a template with
 * its own would show page breaks the PDF does not have.
 *
 * Break rules: a whole entry is kept together when it fits on a page (the
 * print engine splits one that cannot fit, and then its head and each
 * bullet are still kept whole); the preview paginator applies the same
 * rule, see `previewPagination.ts`.
 */

export interface ResumeTemplate {
  id: ResumeTemplateId
  render: (content: ResumeContent, pageSize: ResumePageSize, style?: ResumeStyle) => string
}

/**
 * The user's typography, appended after a template's own CSS so it wins.
 * Templates size everything relative to the body (em), which is what makes
 * one body size setting scale headings and side notes with it.
 */
export function styleCss(style: ResumeStyle | undefined): string {
  if (!style) return ''
  const rules: string[] = []
  if (style.fontFamily) rules.push(`font-family: ${RESUME_FONT_STACKS[style.fontFamily]};`)
  if (style.fontSize !== undefined) rules.push(`font-size: ${style.fontSize}pt;`)
  const body = rules.length > 0 ? `body { ${rules.join(' ')} }` : ''
  const links =
    style.linkStyle === 'blue'
      ? 'a { color: #1a56b0; }'
      : style.linkStyle === 'underline'
        ? 'a { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }'
        : ''
  return body || links ? `\n${[body, links].filter(Boolean).join('\n')}\n` : ''
}

export const PAGE_DIMENSIONS_IN: Record<ResumePageSize, { width: number; height: number }> = {
  letter: { width: 8.5, height: 11 },
  a4: { width: 8.27, height: 11.69 }
}

export const PAGE_MARGIN_IN = 0.6

export function pageCss(pageSize: ResumePageSize): string {
  const { width, height } = PAGE_DIMENSIONS_IN[pageSize]
  return `
@page { size: ${width}in ${height}in; margin: ${PAGE_MARGIN_IN}in; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: ${width}in; min-height: ${height}in; box-sizing: border-box; padding: ${PAGE_MARGIN_IN}in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { body { width: auto; min-height: 0; padding: 0; } }
a { color: inherit; text-decoration: none; }
ul { margin: 0; padding-left: 1.1em; }
li { margin: 0; }
p { margin: 0; }
h1, h2, h3 { margin: 0; font-weight: 600; }
.section { break-inside: auto; }
.entry, .entry-head, .group, li, h1, h2 { break-inside: avoid; }
h2 { break-after: avoid; }
`
}

export function documentHtml(title: string, css: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`
}

export function linkOrText(text: string, url: string | undefined, className?: string): string {
  const href = safeHref(url)
  const classAttr = className ? ` class="${className}"` : ''
  const label = escapeHtml(text)
  return href ? `<a${classAttr} href="${escapeHtml(href)}">${label}</a>` : `<span${classAttr}>${label}</span>`
}

/**
 * A contact prints its value as written, linked to `url` when that is a safe
 * http(s)/mailto address: "LinkedIn" next to a profile link prints as the
 * word LinkedIn (styled per `ResumeStyle.linkStyle`) and clicks through in
 * the PDF. A value that is
 * itself a URL prints without its scheme and links to itself.
 */
export function contactHtml(contact: ResumeContact): string {
  const value = contact.value.trim()
  const href = safeHref(contact.url) ?? safeHref(value)
  const text = safeHref(value) ? displayUrl(value) : value
  // The wrapper carries the class (and Classic's "|" separator pseudo-element)
  // so the separator is never part of the link's underline or colour.
  return `<span class="contact">${linkOrText(text, href ?? undefined)}</span>`
}

export function dateRange(entry: ResumeEntry): string {
  const start = entry.start?.trim() ?? ''
  const end = entry.end?.trim() ?? ''
  if (start && end) return `${start} - ${end}`
  return start || end
}

/**
 * Title over subtitle on the left, dates over the location (`meta`) on the
 * right, bullets underneath across the full width. The right column is
 * emitted only when it has something in it so a template can lay the two
 * columns out however it likes (side by side, or dates in a gutter) without
 * an empty box taking part.
 */
export function entryHtml(entry: ResumeEntry): string {
  const dates = dateRange(entry)
  const meta = entry.meta?.trim() ?? ''
  const subtitle = entry.subtitle?.trim() ?? ''
  const bullets = entry.bullets.filter((bullet) => bullet.trim().length > 0)
  const side = [
    dates ? `<div class="entry-dates">${escapeHtml(dates)}</div>` : '',
    meta ? `<div class="entry-meta">${escapeHtml(meta)}</div>` : ''
  ].join('')
  return `<div class="entry">
  <div class="entry-head">
    <div class="entry-main">
      <div class="entry-title">${linkOrText(entry.title, entry.url)}</div>
      ${subtitle ? `<div class="entry-sub">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    ${side ? `<div class="entry-side">${side}</div>` : ''}
  </div>
  ${bullets.length > 0 ? `<ul class="bullets">${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}
</div>`
}

/**
 * The separator between a group's label and its items belongs to the
 * template (Classic prints a colon, Modern a gutter), so a colon the author
 * typed into the label is dropped rather than printed twice.
 */
export function groupHtml(group: ResumeGroup): string {
  const items = group.items.filter((item) => item.trim().length > 0)
  const label = group.label.trim().replace(/[:\uff1a]+$/, '').trimEnd()
  return `<div class="group"><span class="group-label">${escapeHtml(label)}</span><span class="group-items">${items.map(escapeHtml).join(', ')}</span></div>`
}

export function sectionBodyHtml(section: ResumeSection): string {
  const layout = section.layout
  switch (layout.kind) {
    case 'text':
      return `<p class="text">${escapeHtml(layout.body)}</p>`
    case 'entries':
      return layout.entries.map(entryHtml).join('')
    case 'groups':
      return layout.groups.map(groupHtml).join('')
    case 'list': {
      const items = layout.items.filter((item) => item.trim().length > 0)
      return `<ul class="list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    }
  }
}

/** A section with nothing in it is dropped rather than printed as a lone heading. */
export function isSectionEmpty(section: ResumeSection): boolean {
  const layout = section.layout
  switch (layout.kind) {
    case 'text':
      return layout.body.trim().length === 0
    case 'entries':
      return layout.entries.length === 0
    case 'groups':
      return layout.groups.length === 0
    case 'list':
      return layout.items.every((item) => item.trim().length === 0)
  }
}

export function sectionsHtml(content: ResumeContent): string {
  return content.sections
    .filter((section) => !isSectionEmpty(section))
    .map(
      (section) =>
        `<section class="section section-${section.layout.kind}"><h2>${escapeHtml(section.title)}</h2>${sectionBodyHtml(section)}</section>`
    )
    .join('')
}
