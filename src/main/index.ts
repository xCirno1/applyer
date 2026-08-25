// Static import, so it is evaluated before the assignment below — safe only
// because this module pulls in nothing but `electron` and `path`; anything
// reaching playwright (directly or transitively) must stay a dynamic import
// below the assignment, like ./bootstrap.
import { applyDevUserDataDir } from './config/userDataDir'

// Must be set before playwright's `chromium` is imported anywhere in the app
// (browserController.ts) — this makes it resolve browsers bundled inside
// node_modules/playwright-core/.local-browsers (installed there via
// PLAYWRIGHT_BROWSERS_PATH=0 at `npm install` time) instead of the
// system-wide ~/.cache/ms-playwright, which won't exist on an end user's
// machine after installing a packaged build.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0'

// Must run before ./bootstrap (and everything it pulls in) can read
// app.getPath('userData'), which Electron caches on first read.
applyDevUserDataDir()

void import('./bootstrap')
