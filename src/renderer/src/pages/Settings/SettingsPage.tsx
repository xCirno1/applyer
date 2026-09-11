import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import ProfileSection from './ProfileSection'
import DocumentsSection from './DocumentsSection'
import StorageSection from './StorageSection'
import BrowserSection from './BrowserSection'
import AgentSection from './AgentSection'
import AppearanceSection from './AppearanceSection'
import LanguageSection from './LanguageSection'
import ShortcutsSection from './ShortcutsSection'
import DataSection from './DataSection'
import DeveloperSection from './DeveloperSection'
import NotificationsSection from './NotificationsSection'

// Labels come from the `settings.nav.*` catalog keyed by id, so this list
// only declares which sections exist and in what order.
const SECTIONS = [
  'profile',
  'documents',
  'storage',
  'browser',
  'agent',
  'appearance',
  'language',
  'notifications',
  'shortcuts',
  'data',
  'developer'
] as const

export type SectionId = (typeof SECTIONS)[number]

export default function SettingsPage({
  initialSection = 'profile',
  onOpenExport,
  onOpenImport
}: {
  initialSection?: SectionId
  onOpenExport: () => void
  onOpenImport: () => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const [section, setSection] = useState<SectionId>(initialSection)

  return (
    <div className="flex h-full bg-canvas-inset">
      <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border-soft bg-canvas p-2">
        {SECTIONS.map((id) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`h-7 cursor-pointer px-2 text-left text-[12px] font-medium ${
              section === id ? 'bg-canvas-soft text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {t(`nav.${id}`)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {section === 'profile' && <ProfileSection />}
        {section === 'documents' && <DocumentsSection />}
        {section === 'storage' && <StorageSection />}
        {section === 'browser' && <BrowserSection />}
        {section === 'agent' && <AgentSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'language' && <LanguageSection />}
        {section === 'notifications' && <NotificationsSection />}
        {section === 'shortcuts' && <ShortcutsSection />}
        {section === 'data' && <DataSection onOpenExport={onOpenExport} onOpenImport={onOpenImport} />}
        {section === 'developer' && <DeveloperSection />}
      </div>
    </div>
  )
}
