import { useEffect, useState, type ReactElement } from 'react'
import Menu, { MenuBar, type MenuEntry } from '../ui/Menu'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useToast } from '../ui/useToast'
import { useShortcuts } from '../../providers/ShortcutsContext'
import { comboIdToLabel } from '../../shortcuts/keyCombo'
import type { CommandId } from '../../shortcuts/commands'
import { useJobsStore } from '../../state/jobsStore'
import type { SectionId } from '../../pages/Settings/SettingsPage'

/**
 * The app's VS Code-style menu row (File/Terminal/Jobs/View/Help), replacing
 * what used to be a single standalone `ViewMenu`. Each top-level entry is a
 * `Menu` dropdown; behavior for commands owned by other mounted components
 * (the terminal tab actions) goes through `runCommand` rather than
 * duplicating that logic here, so the menu item and the keyboard shortcut
 * always do exactly the same thing.
 */
export default function AppMenuBar({
  onOpenSettings,
  sidebarVisible,
  onToggleSidebar,
  dockVisible,
  onToggleDock,
  onShowTerminalTab
}: {
  onOpenSettings: (section?: SectionId) => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
  dockVisible: boolean
  onToggleDock: () => void
  onShowTerminalTab: () => void
}): ReactElement {
  const { bindings, runCommand } = useShortcuts()
  const toast = useToast()

  const failedTotal = useJobsStore((s) => s.columns.failed.total)
  const fetchAllColumns = useJobsStore((s) => s.fetchAllColumns)
  const applyUpdate = useJobsStore((s) => s.applyUpdate)

  const [confirmRetryAllOpen, setConfirmRetryAllOpen] = useState(false)
  const [retryingAll, setRetryingAll] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!aboutOpen) return
    window.api.app.getVersion().then(setVersion)
  }, [aboutOpen])

  const shortcutLabel = (commandId: CommandId): string | undefined => {
    const combo = bindings[commandId]
    return combo ? comboIdToLabel(combo) : undefined
  }

  const runTerminalCommand = (commandId: CommandId): void => {
    onShowTerminalTab()
    runCommand(commandId)
  }

  const handleRetryAll = async (): Promise<void> => {
    setConfirmRetryAllOpen(false)
    setRetryingAll(true)
    const result = await window.api.jobs.retryAll()
    setRetryingAll(false)
    if (!result.ok) {
      toast.error('Failed to retry jobs.')
      return
    }
    for (const job of result.jobs) applyUpdate(job)
    toast.success(
      result.jobs.length > 0 ? `Retried ${result.jobs.length} failed job${result.jobs.length === 1 ? '' : 's'}.` : 'No failed jobs to retry.'
    )
  }

  const fileItems: MenuEntry[] = [
    { type: 'action', key: 'settings', label: 'Settings', shortcut: shortcutLabel('app.toggleSettings'), onSelect: () => onOpenSettings() },
    { type: 'separator', key: 'sep' },
    { type: 'action', key: 'quit', label: 'Quit', onSelect: () => window.close() }
  ]

  const terminalItems: MenuEntry[] = [
    {
      type: 'action',
      key: 'new',
      label: 'New Terminal',
      shortcut: shortcutLabel('terminal.new'),
      onSelect: () => runTerminalCommand('terminal.new')
    },
    {
      type: 'action',
      key: 'close',
      label: 'Close Terminal',
      shortcut: shortcutLabel('terminal.close'),
      onSelect: () => runTerminalCommand('terminal.close')
    },
    {
      type: 'action',
      key: 'rename',
      label: 'Rename Terminal',
      shortcut: shortcutLabel('terminal.rename'),
      onSelect: () => runTerminalCommand('terminal.rename')
    },
    { type: 'separator', key: 'sep' },
    {
      type: 'action',
      key: 'next',
      label: 'Next Terminal Tab',
      shortcut: shortcutLabel('terminal.nextTab'),
      onSelect: () => runTerminalCommand('terminal.nextTab')
    },
    {
      type: 'action',
      key: 'prev',
      label: 'Previous Terminal Tab',
      shortcut: shortcutLabel('terminal.prevTab'),
      onSelect: () => runTerminalCommand('terminal.prevTab')
    }
  ]

  const jobsItems: MenuEntry[] = [
    { type: 'action', key: 'refresh', label: 'Refresh Board', onSelect: () => fetchAllColumns() },
    { type: 'separator', key: 'sep' },
    {
      type: 'action',
      key: 'retryAll',
      label: 'Retry All Failed',
      disabled: failedTotal === 0,
      onSelect: () => setConfirmRetryAllOpen(true)
    }
  ]

  const viewItems: MenuEntry[] = [
    {
      type: 'checkbox',
      key: 'overview',
      label: 'Overview',
      checked: sidebarVisible,
      onToggle: onToggleSidebar,
      shortcut: shortcutLabel('view.toggleOverview')
    },
    {
      type: 'checkbox',
      key: 'console',
      label: 'Console',
      checked: dockVisible,
      onToggle: onToggleDock,
      shortcut: shortcutLabel('view.toggleConsole')
    }
  ]

  const helpItems: MenuEntry[] = [
    { type: 'action', key: 'shortcuts', label: 'Keyboard Shortcuts', onSelect: () => onOpenSettings('shortcuts') },
    { type: 'separator', key: 'sep' },
    { type: 'action', key: 'about', label: 'About Applyer', onSelect: () => setAboutOpen(true) }
  ]

  return (
    <div className="flex items-center">
      <MenuBar className="flex items-center">
        <Menu label="File" items={fileItems} />
        <Menu label="Terminal" items={terminalItems} />
        <Menu label="Jobs" items={jobsItems} />
        <Menu label="View" items={viewItems} />
        <Menu label="Help" items={helpItems} />
      </MenuBar>

      <ConfirmDialog
        open={confirmRetryAllOpen}
        title="Retry all failed jobs?"
        message={`This moves ${failedTotal} failed job${failedTotal === 1 ? '' : 's'} back to Queued so they're attempted again.`}
        confirmLabel="Retry all"
        loading={retryingAll}
        onConfirm={handleRetryAll}
        onCancel={() => setConfirmRetryAllOpen(false)}
      />

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="About Applyer" width="max-w-sm">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-text">Applyer</span>
          <span className="text-[12px] text-text-muted">Version {version ?? '—'}</span>
        </div>
      </Modal>
    </div>
  )
}
