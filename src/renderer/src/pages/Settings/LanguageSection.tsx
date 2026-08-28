import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import LanguagePicker from '../../components/settings/LanguagePicker'

/**
 * Settings > Language. The picker itself is shared with onboarding's
 * welcome step (components/settings/LanguagePicker.tsx); this only adds the
 * section chrome around it.
 */
export default function LanguageSection(): ReactElement {
  const { t } = useTranslation('settings')

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{t('language.title')}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('language.intro')}</p>
      </div>

      <LanguagePicker />

      <p className="text-[11px] text-text-faint">{t('language.contribute')}</p>
    </div>
  )
}
