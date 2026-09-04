// Static import, so it is evaluated before the assignment below — safe only
// because this module pulls in nothing but `electron` and `path`; anything
// reaching playwright (directly or transitively) must stay a dynamic import
// below the assignment, like ./bootstrap.
import { applyDevUserDataDir } from './config/userDataDir'
import { loadUserSettings } from './config/settings'

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

// Load the per-user JSON override before bootstrap imports modules which read
// the shared settings. Malformed entries are non-fatal and are reported once
// the logger is available in bootstrap.
const settingsLoadResult = loadUserSettings()
process.env.APPLYER_SETTINGS_WARNINGS = JSON.stringify(settingsLoadResult.warnings)

void import('./bootstrap')
