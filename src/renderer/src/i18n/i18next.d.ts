// Types the whole i18next surface off the English catalogs, so `t('…')` is
// checked at compile time rather than silently rendering a raw key id at
// runtime. `npm run typecheck:web` is what catches a renamed or misspelled
// key — including in the Indonesian catalog, which config.ts types against
// the same shape.
//
// English is the source of truth: adding a key means adding it to
// locales/en/*.json first, which is what makes it visible to `t()`.
import 'i18next'

import type enCommon from './locales/en/common.json'
import type enBoard from './locales/en/board.json'
import type enSettings from './locales/en/settings.json'
import type enOnboarding from './locales/en/onboarding.json'
import type enIndexedJobs from './locales/en/indexedJobs.json'
import type enWorkspace from './locales/en/workspace.json'
import type enErrors from './locales/en/errors.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    returnNull: false
    resources: {
      common: typeof enCommon
      board: typeof enBoard
      settings: typeof enSettings
      onboarding: typeof enOnboarding
      indexedJobs: typeof enIndexedJobs
      workspace: typeof enWorkspace
      errors: typeof enErrors
    }
  }
}
