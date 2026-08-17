import { useState, type ReactElement } from 'react'
import ProfileSection from './ProfileSection'
import DocumentsSection from './DocumentsSection'
import StorageSection from './StorageSection'
import ConnectionsSection from './ConnectionsSection'
import AgentSection from './AgentSection'
import ExclusionsSection from './ExclusionsSection'
import AppearanceSection from './AppearanceSection'
import ShortcutsSection from './ShortcutsSection'

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'documents', label: 'Documents' },
  { id: 'storage', label: 'Storage' },
  { id: 'connections', label: 'Connections' },
  { id: 'agent', label: 'Agent' },
  { id: 'exclusions', label: 'Exclusions' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

export default function SettingsPage(): ReactElement {
  const [section, setSection] = useState<SectionId>('profile')

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
        {section === 'connections' && <ConnectionsSection />}
        {section === 'agent' && <AgentSection />}
        {section === 'exclusions' && <ExclusionsSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'shortcuts' && <ShortcutsSection />}
      </div>
    </div>
  )
}
