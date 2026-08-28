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

/**
 * The language picker itself, shared by Settings > Language and the
 * onboarding welcome step — someone whose system language guessed wrong
 * needs to switch before working through a flow they can't read.
 *
 * Deliberately lists each language in its own script ("Bahasa Indonesia",
 * not "Indonesian"): a user who has landed in a language they can't read
 * has to be able to recognise their own to get out.
 *
 * The option list comes from the `settings` namespace at both call sites so
 * the two pickers can never drift apart in wording; only the field label is
 * per-call-site, since onboarding asks ("Please select your language")
 * where Settings just labels a row.
 */
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
