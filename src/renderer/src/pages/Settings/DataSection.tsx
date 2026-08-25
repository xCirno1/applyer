import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'

/**
 * The Export/Import modals themselves are mounted once at `App.tsx`'s
 * `MainShell` level (like `JobDetailModal`) rather than here, since the
 * File menu's "Export Data…"/"Import Data…" items need to pop them
 * directly without first navigating to this section — this component just
 * triggers the same open callbacks the menu items use.
 */
export default function DataSection({
  onOpenExport,
  onOpenImport
}: {
  onOpenExport: () => void
  onOpenImport: () => void
}): ReactElement {
  const { t } = useTranslation('settings')

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">{t('data.intro')}</p>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col items-start gap-2 border border-border-soft p-3">
          <h2 className="text-[13px] font-semibold text-text">{t('data.exportTitle')}</h2>
          <p className="text-[12px] text-text-muted">{t('data.exportDescription')}</p>
          <Button size="sm" onClick={onOpenExport}>
            {t('data.exportButton')}
          </Button>
        </div>

        <div className="flex flex-1 flex-col items-start gap-2 border border-border-soft p-3">
          <h2 className="text-[13px] font-semibold text-text">{t('data.importTitle')}</h2>
          <p className="text-[12px] text-text-muted">{t('data.importDescription')}</p>
          <Button size="sm" onClick={onOpenImport}>
            {t('data.importButton')}
          </Button>
        </div>
      </div>
    </div>
  )
}
