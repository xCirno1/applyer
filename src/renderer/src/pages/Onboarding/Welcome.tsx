import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import Tooltip from '../../components/ui/Tooltip'
import LanguagePicker from '../../components/settings/LanguagePicker'
import OnboardingShell from '../../components/onboarding/OnboardingShell'

const HOW_IT_WORKS = ['find', 'judge', 'submit'] as const

export default function Welcome({ onNext }: { onNext: () => void }): ReactElement {
  const { t } = useTranslation('onboarding')

  return (
    <OnboardingShell
      step="welcome"
      title={t('welcome.title')}
      subtitle={t('welcome.intro')}
      actions={
        <Button variant="primary" onClick={onNext}>
          {t('welcome.getStarted')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Three abreast with 1px seams between them rather than a stacked
            list: the whole shape of the app fits on one line that way, and
            it reads as a sequence instead of as three paragraphs to get
            through. Stacks below `sm`, where three columns would be three
            words wide. */}
        <ol className="grid grid-cols-1 divide-y divide-border-soft border border-border-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {HOW_IT_WORKS.map((key, index) => (
            <li key={key} className="flex flex-col gap-1 px-3 py-2.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-faint tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="text-[13px] font-medium text-text">{t(`welcome.how.${key}.title`)}</span>
              <p className="text-[12px] text-text-muted">{t(`welcome.how.${key}.body`)}</p>
            </li>
          ))}
        </ol>

        <Callout title={t('welcome.agentNoteTitle')}>
          {t('welcome.agentNoteBefore')}{' '}
          <Tooltip label={t('welcome.mcpTooltip')}>
            <span className="cursor-help border-b border-dotted border-text-faint text-text">
              {t('welcome.mcpTerm')}
            </span>
          </Tooltip>
          {t('welcome.agentNoteAfter')}
        </Callout>

        {/* Offered on the very first screen, not only in Settings: if the
            system-language guess was wrong, the user has to be able to fix
            it before working through the rest of onboarding. */}
        <div className="max-w-[220px]">
          <LanguagePicker id="onboarding-language" label={t('welcome.languagePrompt')} />
        </div>
      </div>
    </OnboardingShell>
  )
}
