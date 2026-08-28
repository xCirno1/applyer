import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import LanguagePicker from '../../components/settings/LanguagePicker'

export default function Welcome({ onNext }: { onNext: () => void }): ReactElement {
  const { t } = useTranslation('onboarding')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">{t('welcome.title')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{t('welcome.intro')}</p>
      </div>
      <ol className="flex flex-col gap-2 text-[13px] text-text-muted">
        <li>
          <span className="font-medium text-text">{t('welcome.step1Title')}</span> {t('welcome.step1Body')}
        </li>
        <li>
          <span className="font-medium text-text">{t('welcome.step2Title')}</span> {t('welcome.step2Body')}
        </li>
        <li>
          <span className="font-medium text-text">{t('welcome.step3Title')}</span> {t('welcome.step3Body')}
        </li>
      </ol>
      {/* Offered on the very first screen, not only in Settings: if the
          system-language guess was wrong, the user has to be able to fix it
          before working through the rest of onboarding. */}
      <div className="max-w-[220px]">
        <LanguagePicker id="onboarding-language" label={t('welcome.languagePrompt')} />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          {t('welcome.getStarted')}
        </Button>
      </div>
    </div>
  )
}
