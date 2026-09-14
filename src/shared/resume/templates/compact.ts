import { escapeHtml } from '../escapeHtml'
import { contactHtml, documentHtml, pageCss, sectionsHtml, type ResumeTemplate, styleCss } from './shared'

/**
 * Dense sans-serif: smaller type, tighter leading, headings inline with a
 * rule, contacts on one line under the name. For people who need to fit
 * more onto one page.
 */
export const compactTemplate: ResumeTemplate = {
  id: 'compact',
  render(content, pageSize, style) {
    const { header } = content
    const css = `${pageCss(pageSize)}
body { font-family: Helvetica, Arial, 'Liberation Sans', sans-serif; font-size: 9.5pt; line-height: 1.28; color: #111; }
.header { display: flex; justify-content: space-between; align-items: flex-end; gap: 12pt; border-bottom: 2px solid #111; padding-bottom: 5pt; margin-bottom: 0.1in; }
.header h1 { font-size: 1.789em; letter-spacing: -0.01em; line-height: 1.1; }
.headline { font-size: 1.053em; color: #333; margin-top: 2pt; }
.contacts { text-align: right; font-size: 0.895em; color: #333; max-width: 3.2in; }
.contacts .contact { display: block; }
.section { margin-top: 0.1in; }
.section h2 { font-size: 0.947em; text-transform: uppercase; letter-spacing: 0.1em; color: #222; display: flex; align-items: center; gap: 6pt; margin-bottom: 3pt; }
.section h2::after { content: ''; flex: 1; border-top: 1px solid #bbb; }
.entry + .entry { margin-top: 4pt; }
.entry-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10pt; }
.entry-main { min-width: 0; }
.entry-side { text-align: right; white-space: nowrap; color: #555; font-size: 0.895em; }
.entry-title { font-weight: 700; }
.entry-sub { color: #333; }
.bullets { margin-top: 1pt; }
.bullets li + li { margin-top: 0.5pt; }
.section-groups .group { display: grid; grid-template-columns: 1.3in 1fr; gap: 6pt; }
.group + .group { margin-top: 1.5pt; }
.group-label { font-weight: 700; }
.list { columns: 2; column-gap: 18pt; }
`
    const body = `<header class="header">
  <div>
    <h1>${escapeHtml(header.fullName)}</h1>
    ${header.headline ? `<div class="headline">${escapeHtml(header.headline)}</div>` : ''}
  </div>
  ${header.contacts.length > 0 ? `<div class="contacts">${header.contacts.map(contactHtml).join('')}</div>` : ''}
</header>
${sectionsHtml(content)}`
    return documentHtml(header.fullName, css + styleCss(style), body)
  }
}
