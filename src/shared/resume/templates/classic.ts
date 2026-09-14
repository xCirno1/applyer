import { escapeHtml } from '../escapeHtml'
import { contactHtml, documentHtml, pageCss, sectionsHtml, type ResumeTemplate, styleCss } from './shared'

/** Single column, serif, centered header, thin rule under each heading. The safe default. */
export const classicTemplate: ResumeTemplate = {
  id: 'classic',
  render(content, pageSize, style) {
    const { header } = content
    const css = `${pageCss(pageSize)}
body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.35; color: #111; }
.header { text-align: center; margin-bottom: 0.18in; }
.header h1 { font-size: 1.905em; letter-spacing: 0.02em; }
.headline { font-size: 1.048em; color: #333; margin-top: 2pt; }
.contacts { margin-top: 4pt; font-size: 0.905em; color: #333; }
.contacts .contact + .contact::before { content: '  |  '; color: #999; white-space: pre; }
.section { margin-top: 0.14in; }
.section h2 { font-size: 1.048em; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #222; padding-bottom: 2pt; margin-bottom: 5pt; }
.entry + .entry { margin-top: 6pt; }
.entry-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12pt; }
.entry-main { min-width: 0; }
.entry-side { text-align: right; white-space: nowrap; color: #444; font-size: 0.905em; }
.entry-title { font-weight: 700; }
.entry-sub { font-style: italic; color: #333; }
.entry-meta { font-style: italic; }
.bullets { margin-top: 2pt; }
.group + .group { margin-top: 2pt; }
.group-label { font-weight: 700; }
.group-label::after { content: ': '; }
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
