import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useShortcuts } from '../../providers/ShortcutsContext'
import { COMMAND_CATEGORIES, COMMAND_LIST, commandLabelKey, type CommandId } from '../../shortcuts/commands'
import { comboIdFromEvent, comboIdToLabel, isMacPlatform } from '../../shortcuts/keyCombo'

interface PendingConflict {
  commandId: CommandId
  comboId: string
  conflicts: CommandId[]
}

export default function ShortcutsSection(): ReactElement {
  const { t } = useTranslation(['settings', 'workspace'])
  const { bindings, setBinding, resetBinding, resetAllBindings, findConflicts, setSuspended } = useShortcuts()
  const [recordingId, setRecordingId] = useState<CommandId | null>(null)
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null)
  const [confirmResetAllOpen, setConfirmResetAllOpen] = useState(false)

  useEffect(() => {
    if (!recordingId) return
    setSuspended(true)

    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        setBinding(recordingId, null)
        setRecordingId(null)
        return
      }
      const comboId = comboIdFromEvent(e)
      if (!comboId) return // not a qualifying combo yet (needs the mod key held, unless it's a function key) — keep listening

      const conflicts = findConflicts(comboId, recordingId)
      if (conflicts.length > 0) {
        setPendingConflict({ commandId: recordingId, comboId, conflicts })
      } else {
        setBinding(recordingId, comboId)
      }
      setRecordingId(null)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      setSuspended(false)
    }
  }, [recordingId, setBinding, findConflicts, setSuspended])

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-text">{t('shortcuts.title')}</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            {t('shortcuts.intro', {
              modifier: isMacPlatform() ? t('shortcuts.modifierMac') : t('shortcuts.modifierOther')
            })}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setConfirmResetAllOpen(true)}>
          {t('shortcuts.resetAll')}
        </Button>
      </div>

      {COMMAND_CATEGORIES.map((category) => (
        <div key={category} className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{t(`commands.category.${category}`, { ns: 'workspace' })}</span>
          <div className="flex flex-col divide-y divide-border-soft border border-border-soft">
            {COMMAND_LIST.filter((c) => c.category === category).map((cmd) => {
              const commandId = cmd.id as CommandId
              const combo = bindings[commandId]
              const isCustomized = combo !== cmd.defaultCombo
              const isRecording = recordingId === commandId
              return (
                <div key={commandId} className="flex h-8 items-center justify-between gap-2 px-2">
                  <span className="text-[12px] text-text">
                    {t(commandLabelKey(commandId), { ns: 'workspace' })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isRecording ? (
                      <span className="text-[11px] text-accent">{t('shortcuts.recording')}</span>
                    ) : combo ? (
                      <kbd className="border border-border bg-canvas-soft px-1.5 py-0.5 font-mono text-[11px] text-text">
                        {comboIdToLabel(combo)}
                      </kbd>
                    ) : (
                      <span className="text-[11px] text-text-faint">{t('shortcuts.notBound')}</span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setRecordingId(commandId)} disabled={isRecording}>
                      {t('shortcuts.edit')}
                    </Button>
                    {isCustomized && (
                      <Button size="sm" variant="ghost" onClick={() => resetBinding(commandId)}>
                        {t('shortcuts.reset')}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={pendingConflict !== null}
        title={t('shortcuts.conflictTitle')}
        message={
          pendingConflict
            ? t('shortcuts.conflictMessage', {
                count: pendingConflict.conflicts.length,
                combo: comboIdToLabel(pendingConflict.comboId),
                commands: pendingConflict.conflicts
                  .map((id) => t(commandLabelKey(id), { ns: 'workspace' }))
                  .join('", "')
              })
            : ''
        }
        confirmLabel={t('shortcuts.conflictConfirm')}
        onConfirm={() => {
          if (!pendingConflict) return
          for (const id of pendingConflict.conflicts) setBinding(id, null)
          setBinding(pendingConflict.commandId, pendingConflict.comboId)
          setPendingConflict(null)
        }}
        onCancel={() => setPendingConflict(null)}
      />

      <ConfirmDialog
        open={confirmResetAllOpen}
        title={t('shortcuts.resetAllTitle')}
        message={t('shortcuts.resetAllMessage')}
        confirmLabel={t('shortcuts.resetAllConfirm')}
        danger
        onConfirm={() => {
          resetAllBindings()
          setConfirmResetAllOpen(false)
        }}
        onCancel={() => setConfirmResetAllOpen(false)}
      />
    </div>
  )
}
