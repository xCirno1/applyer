import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Select from '../ui/Select'
import { useLocale } from '../../providers/LocaleContext'
import {
  SUPPORTED_LOCALES,
  localeNativeName,
  matchSystemLocale,
  systemLanguages,
  type LocalePreference
} from '../../i18n/locale'

interface LanguagePickerProps {
  /** Field label. Defaults to Settings' "Display language". */
  label?: string
  id?: string
}

// The display-language Select (preference via `useLocale`), listing each
// language in its own script ("Bahasa Indonesia", not "Indonesian") so
// someone stuck in a language they can't read can still recognise their own.
// Rendered by Settings > Language and by the onboarding Welcome step (below
// the three steps) — offered during onboarding rather than only in Settings
// so a wrong system-language guess can be fixed without finishing a flow the
// user can't read.
//
// The option list comes from the `settings` namespace at both call sites so
// the wording can't drift; only the field `label` is per-call-site, since
// onboarding asks ("Please select your language") where Settings just labels
// a row.
export default function LanguagePicker({ label, id }: LanguagePickerProps): ReactElement {
  const { t } = useTranslation('settings')
  const { preference, setPreference } = useLocale()

  const systemName = localeNativeName(matchSystemLocale(systemLanguages()))

  const options = [
    { value: 'system', label: t('language.system', { locale: systemName }) },
    ...SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: l.nativeName }))
  ]

  return (
    <Select
      id={id}
      label={label ?? t('language.label')}
      options={options}
      value={preference}
      onChange={(value) => setPreference(value as LocalePreference)}
    />
  )
}
