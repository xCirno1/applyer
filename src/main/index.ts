// Must be set before playwright's `chromium` is imported anywhere in the app
// (browserController.ts) — this makes it resolve browsers bundled inside
// node_modules/playwright-core/.local-browsers (installed there via
// PLAYWRIGHT_BROWSERS_PATH=0 at `npm install` time) instead of the
// system-wide ~/.cache/ms-playwright, which won't exist on an end user's
// machine after installing a packaged build.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0'

void import('./bootstrap')
