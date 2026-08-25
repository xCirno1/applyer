import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import McpCliCard from '../../components/settings/McpCliCard'
import type { McpConfigDetection } from '@shared/types/ipcEvents'

export default function McpSetup({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }): ReactElement {
  const { t } = useTranslation(['onboarding', 'settings'])
  const [detections, setDetections] = useState<McpConfigDetection[] | null>(null)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    window.api.onboarding.detectMcpConfigs().then(setDetections)
  }, [])

  const handleFinish = async (): Promise<void> => {
    setFinishing(true)
    await window.api.onboarding.complete()
    setFinishing(false)
    onFinish()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">{t('mcp.title')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{t('mcp.intro')}</p>
      </div>

      <div className="flex flex-col gap-2">
        {detections === null && (
          <p className="text-[12px] text-text-faint">{t('agent.detecting', { ns: 'settings' })}</p>
        )}
        {detections?.map((d) => (
          <McpCliCard key={d.cli} detection={d} />
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button variant="primary" onClick={handleFinish} loading={finishing}>
          {t('mcp.finish')}
        </Button>
      </div>
    </div>
  )
}
