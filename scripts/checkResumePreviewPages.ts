/*
 * Dev helper: runs the on-screen preview pagination (the same module the
 * renderer uses) over a long sample resume inside the bundled Chromium and
 * screenshots the result, so the page breaks and sheets can be eyeballed
 * without launching the app.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=0 npx tsx scripts/checkResumePreviewPages.ts <outDir>
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright'
import { renderResumeHtml, PAGE_MARGIN_IN } from '../src/shared/resume/templates'
import { SAMPLE_RESUME_CONTENT } from '../src/shared/resume/sampleContent'
import { RESUME_TEMPLATE_IDS } from '../src/shared/types/resume'

const CSS_PX_PER_INCH = 96

async function main(): Promise<void> {
  const outDir = process.argv[2]
  if (!outDir) throw new Error('Usage: checkResumePreviewPages.ts <outDir>')
  mkdirSync(outDir, { recursive: true })

  const bundle = buildSync({
    entryPoints: [join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/components/resume/previewPagination.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'previewPagination'
  }).outputFiles[0]?.text
  if (!bundle) throw new Error('Could not bundle previewPagination.ts')

  // Three copies of the sample sections: long enough to need three pages.
  const content = structuredClone(SAMPLE_RESUME_CONTENT)
  const base = content.sections
  content.sections = [
    ...base,
    ...base.map((section) => ({ ...section, id: `${section.id}-2` })),
    ...base.map((section) => ({ ...section, id: `${section.id}-3` }))
  ]

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1100 } })
    for (const id of RESUME_TEMPLATE_IDS) {
      const style = id === 'classic' ? { fontFamily: 'calibri' as const, fontSize: 12 } : undefined
      await page.setContent(renderResumeHtml(content, id, 'letter', style), { waitUntil: 'load' })
      await page.addScriptTag({ content: bundle })
      const pages = await page.evaluate(
        (geometry) =>
          (
            window as unknown as {
              previewPagination: { paginatePreviewDocument: (doc: Document, geometry: unknown) => number }
            }
          ).previewPagination.paginatePreviewDocument(document, geometry),
        { pageHeight: 11 * CSS_PX_PER_INCH, margin: PAGE_MARGIN_IN * CSS_PX_PER_INCH, gap: 24 }
      )
      // The app shows the sheets over its own inset surface; a grey backdrop here makes the gaps visible.
      await page.evaluate(() => {
        document.documentElement.style.background = '#8a8a8a'
      })
      await page.screenshot({ path: join(outDir, `preview-${id}.png`), fullPage: true })
      process.stdout.write(`${id}: ${pages} pages\n`)
    }
  } finally {
    await browser.close()
  }
}

void main()
