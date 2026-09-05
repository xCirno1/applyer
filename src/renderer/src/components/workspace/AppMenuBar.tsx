import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Menu, { MenuBar, type MenuEntry } from '../ui/Menu'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useToast } from '../ui/useToast'
import { useShortcuts } from '../../providers/ShortcutsContext'
import { comboIdToLabel } from '../../shortcuts/keyCombo'
import type { CommandId } from '../../shortcuts/commands'
import { useJobsStore } from '../../state/jobsStore'
import { useAppInfo } from '../../state/useAppInfo'
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
  onOpenExport,
  onOpenImport,
  sidebarVisible,
  onToggleSidebar,
  dockVisible,
  onToggleDock,
  onShowTerminalTab
}: {
  onOpenSettings: (section?: SectionId) => void
  onOpenExport: () => void
  onOpenImport: () => void
  sidebarVisible: boolean
  onToggleSidebar: () => void
  dockVisible: boolean
  onToggleDock: () => void
  onShowTerminalTab: () => void
}): ReactElement {
  const { t } = useTranslation('workspace')
  const { bindings, runCommand } = useShortcuts()
  const toast = useToast()

  const failedTotal = useJobsStore((s) => s.columns.failed.total)
  const fetchAllColumns = useJobsStore((s) => s.fetchAllColumns)
  const applyUpdate = useJobsStore((s) => s.applyUpdate)

  const [confirmRetryAllOpen, setConfirmRetryAllOpen] = useState(false)
  const [retryingAll, setRetryingAll] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const appInfo = useAppInfo()

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
      toast.error(t('retryAll.failed'))
      return
    }
    for (const job of result.jobs) applyUpdate(job)
    toast.success(
      result.jobs.length > 0 ? t('retryAll.done', { count: result.jobs.length }) : t('retryAll.none')
    )
  }

  const fileItems: MenuEntry[] = [
    { type: 'action', key: 'settings', label: t('menu.settings'), shortcut: shortcutLabel('app.toggleSettings'), onSelect: () => onOpenSettings() },
    { type: 'separator', key: 'sep-data' },
    { type: 'action', key: 'export', label: t('menu.exportData'), onSelect: onOpenExport },
    { type: 'action', key: 'import', label: t('menu.importData'), onSelect: onOpenImport },
    { type: 'separator', key: 'sep' },
    { type: 'action', key: 'quit', label: t('menu.quit'), onSelect: () => window.close() }
  ]

  const terminalItems: MenuEntry[] = [
    {
      type: 'action',
      key: 'new',
      label: t('menu.newTerminal'),
      shortcut: shortcutLabel('terminal.new'),
      onSelect: () => runTerminalCommand('terminal.new')
    },
    {
      type: 'action',
      key: 'close',
      label: t('menu.closeTerminal'),
      shortcut: shortcutLabel('terminal.close'),
      onSelect: () => runTerminalCommand('terminal.close')
    },
    {
      type: 'action',
      key: 'rename',
      label: t('menu.renameTerminal'),
      shortcut: shortcutLabel('terminal.rename'),
      onSelect: () => runTerminalCommand('terminal.rename')
    },
    { type: 'separator', key: 'sep-rename' },
    {
      type: 'action',
      key: 'search',
      label: t('menu.findInTerminal'),
      shortcut: shortcutLabel('terminal.search'),
      onSelect: () => runTerminalCommand('terminal.search')
    },
    { type: 'separator', key: 'sep' },
    {
      type: 'action',
      key: 'next',
      label: t('menu.nextTerminalTab'),
      shortcut: shortcutLabel('terminal.nextTab'),
      onSelect: () => runTerminalCommand('terminal.nextTab')
    },
    {
      type: 'action',
      key: 'prev',
      label: t('menu.prevTerminalTab'),
      shortcut: shortcutLabel('terminal.prevTab'),
      onSelect: () => runTerminalCommand('terminal.prevTab')
    }
  ]

  const jobsItems: MenuEntry[] = [
    { type: 'action', key: 'refresh', label: t('menu.refreshBoard'), onSelect: () => fetchAllColumns() },
    { type: 'separator', key: 'sep' },
    {
      type: 'action',
      key: 'retryAll',
      label: t('menu.retryAllFailed'),
      disabled: failedTotal === 0,
      onSelect: () => setConfirmRetryAllOpen(true)
    }
  ]

  const viewItems: MenuEntry[] = [
    {
      type: 'checkbox',
      key: 'overview',
      label: t('menu.overview'),
      checked: sidebarVisible,
      onToggle: onToggleSidebar,
      shortcut: shortcutLabel('view.toggleOverview')
    },
    {
      type: 'checkbox',
      key: 'console',
      label: t('menu.console'),
      checked: dockVisible,
      onToggle: onToggleDock,
      shortcut: shortcutLabel('view.toggleConsole')
    }
  ]

  const helpItems: MenuEntry[] = [
    { type: 'action', key: 'shortcuts', label: t('menu.keyboardShortcuts'), onSelect: () => onOpenSettings('shortcuts') },
    { type: 'separator', key: 'sep' },
    { type: 'action', key: 'about', label: t('menu.about'), onSelect: () => setAboutOpen(true) }
  ]

  return (
    <div className="flex items-center">
      <MenuBar className="flex items-center">
        <Menu label={t('menu.file')} items={fileItems} />
        <Menu label={t('menu.terminal')} items={terminalItems} />
        <Menu label={t('menu.jobs')} items={jobsItems} />
        <Menu label={t('menu.view')} items={viewItems} />
        <Menu label={t('menu.help')} items={helpItems} />
      </MenuBar>

      <ConfirmDialog
        open={confirmRetryAllOpen}
        title={t('retryAll.title')}
        message={t('retryAll.message', { count: failedTotal })}
        confirmLabel={t('retryAll.confirm')}
        loading={retryingAll}
        onConfirm={handleRetryAll}
        onCancel={() => setConfirmRetryAllOpen(false)}
      />

      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title={t('about.title')} width="max-w-sm">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-text">{t('about.name')}</span>
          <span className="text-[12px] text-text-muted">
            {t('about.version', { version: appInfo?.version ?? t('states.loading', { ns: 'common' }) })}
          </span>
          {appInfo && (
            <span className="mt-1 text-[12px] text-text-muted">
              {t('about.dataDirectory')}{' '}
              <span className="break-all text-text">{appInfo.userDataDir}</span>
            </span>
          )}
        </div>
      </Modal>
    </div>
  )
}
