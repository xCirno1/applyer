/*
 * Page breaks for the on-screen preview. The PDF is paginated by Chromium's
 * print engine, which the preview frame (a normal, continuous document)
 * never runs, so without help the preview is one endless sheet with no hint
 * of where page two starts. This module reproduces the print rules the
 * templates declare (`break-inside: avoid` on entries, entry heads, bullets,
 * groups and headings; `break-after: avoid` on headings) by measuring the
 * blocks and inserting spacers that push a block that would straddle a page
 * edge to the top of the next page, then draws a white sheet behind each
 * page. An entry that fits on a page is one block, so its head and bullets
 * move together; one taller than a page cannot be kept whole, and its head
 * and bullets are the blocks instead, the way the print engine falls back.
 *
 * Two halves: `planPageBreaks` is pure arithmetic over measured boxes (what
 * the tests exercise) and `paginatePreviewDocument` is the DOM wrapper that
 * measures, applies the plan, and paints the sheets. The frame is same
 * origin (sandbox `allow-same-origin`, no scripts), which is what lets the
 * parent reach into its document at all.
 */

export interface PreviewBlock {
  /** Document-relative top of the block in CSS px, before any spacer is inserted. */
  top: number
  height: number
  /** A heading stays with whatever follows it; a lone heading at a page foot reads as a mistake. */
  keepWithNext?: boolean
}

export interface PageGeometry {
  pageHeight: number
  /** Top and bottom margin inside each page (the body padding on screen, `@page` margin in print). */
  margin: number
  /** Visual gap between two sheets. */
  gap: number
}

export interface PagePlan {
  /** `height` px of empty space to insert before block `index`, in document order. */
  spacers: Array<{ index: number; height: number }>
  pageCount: number
}

/** Where page `page`'s content area starts, sheets and gaps included. */
export function pageContentTop(page: number, geometry: PageGeometry): number {
  return geometry.margin + page * (geometry.pageHeight + geometry.gap)
}

/** Sub-pixel layout makes "bottom == page end" land a hair over; treat that as fitting. */
const FIT_TOLERANCE_PX = 0.5

/**
 * The page whose sheet (content area plus the gap after it) holds `top`.
 * A block that starts in the gap belongs to the page before it, so the
 * push that follows moves it forward onto the next sheet, never backwards.
 */
function pageAt(top: number, geometry: PageGeometry): number {
  const stride = geometry.pageHeight + geometry.gap
  return Math.max(0, Math.floor((top - geometry.margin + FIT_TOLERANCE_PX) / stride))
}

export function planPageBreaks(blocks: readonly PreviewBlock[], geometry: PageGeometry): PagePlan {
  const contentHeight = geometry.pageHeight - 2 * geometry.margin
  if (!(contentHeight > 0) || !Number.isFinite(contentHeight)) return { spacers: [], pageCount: 1 }

  const spacers: PagePlan['spacers'] = []
  let offset = 0
  let page = 0
  let lastBottom = 0

  blocks.forEach((block, index) => {
    const top = block.top + offset
    const ownBottom = block.top + block.height + offset
    // The page only ever advanced with a spacer; after a block that spans
    // pages (nothing to push) the next block can already sit further on,
    // and judging it against the old page would compute a backwards push.
    page = Math.max(page, pageAt(top, geometry))
    const next = block.keepWithNext ? blocks[index + 1] : undefined
    const withNextBottom = next ? next.top + next.height + offset : ownBottom
    // Keep a heading with its follower unless the pair could never share a
    // page anyway; then the heading is judged on its own.
    const unitBottom = withNextBottom - top <= contentHeight ? withNextBottom : ownBottom

    const pageTop = pageContentTop(page, geometry)
    const pageBottom = pageTop + contentHeight
    const overruns = unitBottom > pageBottom + FIT_TOLERANCE_PX
    const atPageTop = top <= pageTop + FIT_TOLERANCE_PX
    // A block already at a page's top that still overruns it is taller than
    // a page: nothing to push, it simply spans.
    if (overruns && !atPageTop && unitBottom - top <= contentHeight) {
      page += 1
      const push = pageContentTop(page, geometry) - top
      spacers.push({ index, height: push })
      offset += push
      lastBottom = Math.max(lastBottom, ownBottom + push)
      return
    }
    lastBottom = Math.max(lastBottom, ownBottom)
  })

  // A block that spans more than one page still counts every sheet it touches.
  const stride = geometry.pageHeight + geometry.gap
  const lastPage = lastBottom > 0 ? Math.floor(Math.max(0, lastBottom - geometry.margin - FIT_TOLERANCE_PX) / stride) : 0
  return { spacers, pageCount: Math.max(page, lastPage) + 1 }
}

/** The blocks a template promises never to split across pages, in document order. */
const BLOCK_SELECTOR = 'header, .section > h2, .entry, .entry-head, .bullets > li, .list > li, .group, p.text'

export interface BlockCandidate {
  /** An `.entry`, something inside one (its head or a bullet), or anything else. */
  role: 'entry' | 'entryPart' | 'other'
  /** For an entry and its parts: the height of the entry. */
  entryHeight?: number
}

/**
 * Which measured candidates become blocks: an entry that fits on a page
 * stands in for its head and bullets, and one that does not is dropped in
 * favour of them. Pure so the rule is testable without layout.
 */
export function pickBlockCandidates<T extends BlockCandidate>(candidates: readonly T[], contentHeight: number): T[] {
  return candidates.filter((candidate) => {
    if (candidate.role === 'other') return true
    const fits = (candidate.entryHeight ?? Number.POSITIVE_INFINITY) <= contentHeight + FIT_TOLERANCE_PX
    return candidate.role === 'entry' ? fits : !fits
  })
}
const SPACER_ATTR = 'data-preview-spacer'
const SHEETS_ATTR = 'data-preview-sheets'

/** A `display: contents` box (Modern's entry head) has no rect of its own; take its children's. */
function blockRect(element: Element): { top: number; height: number } {
  const own = element.getBoundingClientRect()
  if (own.height > 0) return { top: own.top, height: own.height }
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const child of Array.from(element.children)) {
    const rect = child.getBoundingClientRect()
    if (rect.height === 0) continue
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  return Number.isFinite(top) ? { top, height: bottom - top } : { top: own.top, height: 0 }
}

/** Where a spacer goes so it does not become a stray grid item: before the whole entry for an entry head. */
function spacerAnchor(element: Element): Element {
  return element.classList.contains('entry-head') ? (element.closest('.entry') ?? element) : element
}

/**
 * Applies page breaks and sheets to a loaded preview document and returns
 * how many pages it takes. Safe to call again on the same document (it
 * undoes its previous pass first), which a resize does not need but a
 * second `load` of the same frame would.
 */
export function paginatePreviewDocument(doc: Document, geometry: PageGeometry): number {
  const body = doc.body
  if (!body) return 1
  for (const stale of Array.from(doc.querySelectorAll(`[${SPACER_ATTR}], [${SHEETS_ATTR}]`))) stale.remove()

  const scrollTop = doc.documentElement.scrollTop
  const contentHeight = geometry.pageHeight - 2 * geometry.margin
  const entryHeights = new Map<Element, number>()
  const candidates = Array.from(body.querySelectorAll(BLOCK_SELECTOR)).map((element) => {
    const entry = element.classList.contains('entry') ? element : element.closest('.entry')
    let entryHeight: number | undefined
    if (entry) {
      entryHeight = entryHeights.get(entry)
      if (entryHeight === undefined) {
        entryHeight = blockRect(entry).height
        entryHeights.set(entry, entryHeight)
      }
    }
    const role: BlockCandidate['role'] = entry === element ? 'entry' : entry ? 'entryPart' : 'other'
    return { element, role, entryHeight }
  })
  const elements = pickBlockCandidates(candidates, contentHeight).map((candidate) => candidate.element)
  const blocks: PreviewBlock[] = elements.map((element) => {
    const rect = blockRect(element)
    return {
      top: rect.top + scrollTop,
      height: rect.height,
      keepWithNext: element.tagName === 'H2' || element.classList.contains('entry-head')
    }
  })
  const plan = planPageBreaks(blocks, geometry)

  for (const { index, height } of plan.spacers) {
    const element = elements[index]
    if (!element) continue
    const anchor = spacerAnchor(element)
    const parent = anchor.parentElement
    if (!parent) continue
    const spacer = doc.createElement(parent.tagName === 'UL' || parent.tagName === 'OL' ? 'li' : 'div')
    spacer.setAttribute(SPACER_ATTR, '')
    spacer.setAttribute('aria-hidden', 'true')
    spacer.style.cssText = `display:block;height:${height}px;list-style:none;margin:0;padding:0;`
    parent.insertBefore(spacer, anchor)
  }

  const sheets = doc.createElement('div')
  sheets.setAttribute(SHEETS_ATTR, '')
  sheets.setAttribute('aria-hidden', 'true')
  for (let page = 0; page < plan.pageCount; page += 1) {
    const sheet = doc.createElement('div')
    sheet.style.cssText = [
      'position:absolute',
      'left:0',
      `top:${page * (geometry.pageHeight + geometry.gap)}px`,
      'width:100%',
      `height:${geometry.pageHeight}px`,
      'background:#fff',
      'outline:1px solid rgba(0,0,0,0.18)',
      'z-index:-1',
      'pointer-events:none'
    ].join(';')
    sheets.appendChild(sheet)
  }
  body.appendChild(sheets)

  const total = plan.pageCount * geometry.pageHeight + (plan.pageCount - 1) * geometry.gap
  const style = doc.createElement('style')
  style.setAttribute(SHEETS_ATTR, '')
  style.textContent = `html, body { background: transparent !important; overflow: hidden !important; } body { position: relative; min-height: 0 !important; height: ${total}px; }`
  doc.head.appendChild(style)
  return plan.pageCount
}

export function previewTotalHeight(pageCount: number, geometry: PageGeometry): number {
  return pageCount * geometry.pageHeight + Math.max(0, pageCount - 1) * geometry.gap
}
