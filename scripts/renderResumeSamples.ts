/*
 * Dev helper: renders the sample resume through every built-in template to
 * PNG and PDF, so a template change can be eyeballed without launching the
 * app. Uses the same Playwright Chromium the app bundles.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=0 npx tsx scripts/renderResumeSamples.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderResumeHtml } from '../src/shared/resume/templates'
import { SAMPLE_RESUME_CONTENT } from '../src/shared/resume/sampleContent'
import { RESUME_TEMPLATE_IDS } from '../src/shared/types/resume'

async function main(): Promise<void> {
  const outDir = process.argv[2]
  if (!outDir) throw new Error('Usage: renderResumeSamples.ts <outDir>')
  mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 } })
    for (const id of RESUME_TEMPLATE_IDS) {
      const html = renderResumeHtml(SAMPLE_RESUME_CONTENT, id, 'letter')
      await page.setContent(html, { waitUntil: 'load' })
      await page.screenshot({ path: join(outDir, `${id}.png`), fullPage: false })
      const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true })
      writeFileSync(join(outDir, `${id}.pdf`), pdf)
      process.stdout.write(`${id}: ${pdf.length} bytes\n`)
    }
  } finally {
    await browser.close()
  }
}

void main()
