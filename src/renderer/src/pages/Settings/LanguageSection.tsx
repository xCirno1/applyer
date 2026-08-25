import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Select from '../../components/ui/Select'
import { useLocale } from '../../providers/LocaleContext'
import { SUPPORTED_LOCALES, matchSystemLocale, systemLanguages, type LocalePreference } from '../../i18n/locale'

/**
 * Language picker. Deliberately lists each language in its own script
 * ("Bahasa Indonesia", not "Indonesian") — someone who has landed in a
 * language they can't read needs to recognise their own to get out.
 */
export default function LanguageSection(): ReactElement {
  const { t } = useTranslation('settings')
  const { preference, setPreference } = useLocale()

  const systemMatch = matchSystemLocale(systemLanguages())
  const systemName =
    SUPPORTED_LOCALES.find((l) => l.code === systemMatch)?.nativeName ?? systemMatch

  const options = [
    { value: 'system', label: t('language.system', { locale: systemName }) },
    ...SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: l.nativeName }))
  ]

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{t('language.title')}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('language.intro')}</p>
      </div>

      <Select
        label={t('language.label')}
        options={options}
        value={preference}
        onChange={(value) => setPreference(value as LocalePreference)}
      />

      <p className="text-[11px] text-text-faint">{t('language.contribute')}</p>
    </div>
  )
}
