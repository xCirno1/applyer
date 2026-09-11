import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import AdvancedSettingsEditor from '../../components/settings/AdvancedSettingsEditor'
import Checkbox from '../../components/ui/Checkbox'
import { readDeveloperMode, writeDeveloperMode } from './developerMode'

export default function DeveloperSection(): ReactElement {
  const { t } = useTranslation('settings')
  const [enabled, setEnabled] = useState(readDeveloperMode)

  const setDeveloperMode = (next: boolean): void => {
    setEnabled(next)
    writeDeveloperMode(next)
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{t('developer.title')}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('developer.intro')}</p>
      </div>

      <Checkbox
        id="developer-mode"
        label={t('developer.modeLabel')}
        hint={t('developer.modeHint')}
        checked={enabled}
        onChange={setDeveloperMode}
      />

      {enabled && (
        <div className="flex flex-col gap-3 border-t border-border-soft pt-4">
          <div>
            <h3 className="text-[12px] font-semibold text-text">{t('developer.configurationTitle')}</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">{t('developer.configurationIntro')}</p>
          </div>
          <AdvancedSettingsEditor />
        </div>
      )}
    </div>
  )
}
