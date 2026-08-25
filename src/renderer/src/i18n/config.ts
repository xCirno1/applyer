// i18next initialisation. Catalogs are imported statically rather than
// fetched through a backend plugin: this is a single-bundle Electron
// renderer with no network origin to fetch from, and the whole catalog set
// is a few tens of KB — lazy namespace loading would buy nothing and add a
// suspense boundary to every screen.
//
// Namespaces mirror the components/ directory split (board, settings,
// onboarding, indexedJobs, workspace) plus two cross-cutting ones: `common`
// for shared primitives and `errors` for the codes the main process returns
// over IPC (see src/shared/types/errorCodes.ts).
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enCommon from './locales/en/common.json'
import enBoard from './locales/en/board.json'
import enSettings from './locales/en/settings.json'
import enOnboarding from './locales/en/onboarding.json'
import enIndexedJobs from './locales/en/indexedJobs.json'
import enWorkspace from './locales/en/workspace.json'
import enErrors from './locales/en/errors.json'

import idCommon from './locales/id/common.json'
import idBoard from './locales/id/board.json'
import idSettings from './locales/id/settings.json'
import idOnboarding from './locales/id/onboarding.json'
import idIndexedJobs from './locales/id/indexedJobs.json'
import idWorkspace from './locales/id/workspace.json'
import idErrors from './locales/id/errors.json'

import { FALLBACK_LOCALE, readStoredLocale, resolveLocale, systemLanguages } from './locale'

export const defaultNS = 'common'

export const resources = {
  en: {
    common: enCommon,
    board: enBoard,
    settings: enSettings,
    onboarding: enOnboarding,
    indexedJobs: enIndexedJobs,
    workspace: enWorkspace,
    errors: enErrors
  },
  id: {
    common: idCommon,
    board: idBoard,
    settings: idSettings,
    onboarding: idOnboarding,
    indexedJobs: idIndexedJobs,
    workspace: idWorkspace,
    errors: idErrors
  }
} as const

i18n.use(initReactI18next).init({
  resources,
  lng: resolveLocale(readStoredLocale(), systemLanguages()),
  fallbackLng: FALLBACK_LOCALE,
  defaultNS,
  ns: ['common', 'board', 'settings', 'onboarding', 'indexedJobs', 'workspace', 'errors'],
  interpolation: {
    // React escapes interpolated values on render already; letting i18next
    // escape them too would double-encode apostrophes in job titles and
    // company names.
    escapeValue: false
  },
  // A missing key should render as the English string, never as `null` —
  // `returnNull: false` makes an empty catalog entry fall through to the
  // fallback language instead of blanking the UI.
  returnNull: false
})

export default i18n
