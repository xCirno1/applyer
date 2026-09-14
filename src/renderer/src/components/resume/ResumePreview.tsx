import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PAGE_DIMENSIONS_IN, PAGE_MARGIN_IN } from '@shared/resume/templates'
import type { ResumePageSize } from '@shared/types/resume'
import Skeleton from '../ui/Skeleton'
import { paginatePreviewDocument, previewTotalHeight } from './previewPagination'

/*
 * Renders template HTML in a sandboxed frame, scaled to the width it is
 * given so a Letter page fits a 300px thumbnail and an 800px preview alike.
 *
 * Why a frame and not `dangerouslySetInnerHTML`: the template ships its own
 * stylesheet with `body`/`h1`/`ul` rules, and a frame is the only thing that
 * keeps those from bleeding into the app (or the app's Tailwind reset from
 * bleeding into the resume). The HTML is the exact string main hands to
 * Chromium for the PDF, so what the frame shows is what gets attached.
 *
 * The sandbox allows same-origin and nothing else. No scripts can run
 * (templates never emit any, and every string in them is escaped), and
 * same-origin is what lets this component read the document's height after
 * load: the frame is sized to the whole document, so the page scrolls as one
 * surface instead of a scaled box with its own scrollbar inside.
 */

/** Space between two sheets in the frame's own (unscaled) pixels. */
const PAGE_GAP_PX = 24
const CSS_PX_PER_INCH = 96

interface ResumePreviewProps {
  /** Null while the content is loading; the frame then shows a page-shaped skeleton. */
  html: string | null
  pageSize: ResumePageSize
  /** Extra classes for the scroll container (sizing is the caller's job). */
  className?: string
  /**
   * Thumbnails are not interactive: the frame is hidden from the accessibility
   * tree and takes no pointer events, so a click lands on whatever wraps the
   * preview (the template card's button) instead of dying inside the frame's
   * own document.
   */
  decorative?: boolean
}

export default function ResumePreview({ html, pageSize, className = '', decorative = false }: ResumePreviewProps): ReactElement {
  const { t } = useTranslation('resumes')
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  // Keyed by the html it was measured for, so a new document starts from the
  // page height again instead of keeping the previous one's until it loads.
  const [measured, setMeasured] = useState<{ html: string; heightPx: number } | null>(null)

  const pageWidthPx = PAGE_DIMENSIONS_IN[pageSize].width * CSS_PX_PER_INCH
  const pageHeightPx = PAGE_DIMENSIONS_IN[pageSize].height * CSS_PX_PER_INCH

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = (): void => setContainerWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Once the document has loaded, break it into pages the way print would
  // and size the frame to the sheets (see `previewPagination.ts`). The frame
  // is never scrollable itself; the container around it scrolls.
  const measure = (): void => {
    const doc = frameRef.current?.contentDocument
    if (!doc?.documentElement || html === null) return
    const geometry = { pageHeight: pageHeightPx, margin: PAGE_MARGIN_IN * CSS_PX_PER_INCH, gap: PAGE_GAP_PX }
    let pageCount = 1
    try {
      pageCount = paginatePreviewDocument(doc, geometry)
    } catch (error) {
      console.error(`Resume preview could not be paginated: ${String(error)}`)
    }
    setMeasured({ html, heightPx: previewTotalHeight(pageCount, geometry) })
  }

  const scale = containerWidth > 0 ? containerWidth / pageWidthPx : 1
  const documentHeightPx = measured && measured.html === html ? measured.heightPx : null
  const frameHeightPx = Math.max(documentHeightPx ?? pageHeightPx, pageHeightPx)

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {html === null ? (
        <div style={{ height: pageHeightPx * scale }}>
          <Skeleton className="h-full w-full" />
        </div>
      ) : (
        <div style={{ width: pageWidthPx * scale, height: frameHeightPx * scale }} className="relative overflow-hidden">
          <iframe
            ref={frameRef}
            title={decorative ? '' : t('preview.title')}
            aria-hidden={decorative || undefined}
            tabIndex={decorative ? -1 : undefined}
            sandbox="allow-same-origin"
            srcDoc={html}
            onLoad={measure}
            style={{
              width: pageWidthPx,
              height: frameHeightPx,
              transform: `scale(${scale})`,
              transformOrigin: 'top left'
            }}
            scrolling="no"
            className={`absolute left-0 top-0 border-0 ${decorative ? 'pointer-events-none' : ''}`}
          />
        </div>
      )}
    </div>
  )
}
