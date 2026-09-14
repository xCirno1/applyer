import { escapeHtml } from '../escapeHtml'
import { contactHtml, documentHtml, pageCss, sectionsHtml, type ResumeTemplate, styleCss } from './shared'

/**
 * Sans-serif with a single accent colour: a thick accent bar beside the
 * name, accent-coloured headings, dates set in the left gutter. Still one
 * column and still plain text, so it parses the same as the others.
 */
export const modernTemplate: ResumeTemplate = {
  id: 'modern',
  render(content, pageSize, style) {
    const { header } = content
    const css = `${pageCss(pageSize)}
body { font-family: 'Segoe UI', Helvetica, Arial, 'Liberation Sans', sans-serif; font-size: 10pt; line-height: 1.35; color: #1a1a1a; }
.header { border-left: 5px solid #1f5f8b; padding-left: 10pt; margin-bottom: 0.2in; }
.header h1 { font-size: 2.2em; line-height: 1.05; color: #1f5f8b; }
.headline { font-size: 1.1em; color: #444; margin-top: 3pt; }
.contacts { margin-top: 5pt; font-size: 0.9em; color: #444; display: flex; flex-wrap: wrap; gap: 3pt 14pt; }
.section { margin-top: 0.16in; }
.section h2 { font-size: 1.05em; color: #1f5f8b; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 5pt; }
.entry { display: grid; grid-template-columns: 1.15in 1fr; column-gap: 10pt; }
.entry + .entry { margin-top: 7pt; }
.entry-head { display: contents; }
.entry-side { grid-column: 1; grid-row: 1 / span 2; color: #555; font-size: 0.9em; padding-top: 1pt; }
.entry-main { grid-column: 2; grid-row: 1; }
.entry-title { font-weight: 700; }
.entry-sub { color: #444; }
.bullets { grid-column: 2; grid-row: 2; margin-top: 2pt; }
.section-groups .group { display: grid; grid-template-columns: 1.15in 1fr; column-gap: 10pt; }
.group + .group { margin-top: 2pt; }
.group-label { color: #555; font-size: 0.9em; padding-top: 1pt; }
.section-text .text, .section-list .list { margin-left: calc(1.15in + 10pt); }
`
    const body = `<header class="header">
  <h1>${escapeHtml(header.fullName)}</h1>
  ${header.headline ? `<div class="headline">${escapeHtml(header.headline)}</div>` : ''}
  ${header.contacts.length > 0 ? `<div class="contacts">${header.contacts.map(contactHtml).join('')}</div>` : ''}
</header>
${sectionsHtml(content)}`
    return documentHtml(header.fullName, css + styleCss(style), body)
  }
}
