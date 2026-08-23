import { useState, type ReactElement } from 'react'
import ProfileSection from './ProfileSection'
import DocumentsSection from './DocumentsSection'
import StorageSection from './StorageSection'
import AgentSection from './AgentSection'
import AppearanceSection from './AppearanceSection'
import ShortcutsSection from './ShortcutsSection'
import DataSection from './DataSection'

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'documents', label: 'Documents' },
  { id: 'storage', label: 'Storage' },
  { id: 'agent', label: 'Agent' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'data', label: 'Data' }
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

export default function SettingsPage({
  initialSection = 'profile',
  onOpenExport,
  onOpenImport
}: {
  initialSection?: SectionId
  onOpenExport: () => void
  onOpenImport: () => void
}): ReactElement {
  const [section, setSection] = useState<SectionId>(initialSection)

  return (
    <div className="flex h-full bg-canvas-inset">
      <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border-soft bg-canvas p-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`h-7 cursor-pointer px-2 text-left text-[12px] font-medium ${
              section === s.id ? 'bg-canvas-soft text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {section === 'profile' && <ProfileSection />}
        {section === 'documents' && <DocumentsSection />}
        {section === 'storage' && <StorageSection />}
        {section === 'agent' && <AgentSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'shortcuts' && <ShortcutsSection />}
        {section === 'data' && <DataSection onOpenExport={onOpenExport} onOpenImport={onOpenImport} />}
      </div>
    </div>
  )
}
