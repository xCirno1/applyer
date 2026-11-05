import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import TextArea from '../ui/TextArea'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'
import Tooltip from '../ui/Tooltip'
import Callout from '../ui/Callout'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useToast } from '../ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { appError, type AppError } from '@shared/types/errorCodes'
import type { CustomSystemPromptResult } from '@shared/types/customSystemPrompt'
import { customPromptEditorState } from './customSystemPromptLogic'

/** callIpc's fallback for a rejected bridge call: the same failure shape a refused request has. */
const BRIDGE_FAILURE: CustomSystemPromptResult = {
  ok: false,
  error: appError('unexpected')
}

function requestPrompt(): Promise<CustomSystemPromptResult> {
  return callIpc('settings.getCustomSystemPrompt', () => window.api.settings.getCustomSystemPrompt(), BRIDGE_FAILURE)
}

type LoadState = { phase: 'loading' } | { phase: 'error'; error: AppError } | { phase: 'ready'; saved: string }

/**
 * Settings > Agent's editor for the user's own agent instructions, shown
 * under whichever mode's setup is active because the text applies to both
 * (main appends it to the chat system prompt, the CLI instruction file and
 * the MCP server's `instructions`; see `@shared/types/customSystemPrompt`).
 *
 * The draft is held locally and only Save writes it, so typing never costs a
 * round trip per keystroke and a half-written rule never reaches an agent.
 * A read that fails (an encrypted row the keychain cannot open right now)
 * shows an error with Retry instead of an empty editor: an empty editor
 * would invite a Save that replaces text the user simply cannot see. Clear
 * goes through the app's confirm dialog since it discards everything at
 * once, where Discard only drops the unsaved edits.
 */
export default function CustomSystemPromptEditor(): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const applyResult = useCallback((result: CustomSystemPromptResult): void => {
    if (result.ok && typeof result.prompt === 'string') {
      setLoad({ phase: 'ready', saved: result.prompt })
      setDraft(result.prompt)
    } else {
      setLoad({
        phase: 'error',
        error: result.ok ? appError('unexpected') : result.error
      })
    }
  }, [])

  useEffect(() => {
    void requestPrompt().then(applyResult)
  }, [applyResult])

  const retry = (): void => {
    setLoad({ phase: 'loading' })
    void requestPrompt().then(applyResult)
  }

  const save = async (text: string): Promise<void> => {
    setSaving(true)
    const result = await callIpc(
      'settings.setCustomSystemPrompt',
      () => window.api.settings.setCustomSystemPrompt(text),
      BRIDGE_FAILURE
    )
    setSaving(false)
    setConfirmingClear(false)
    if (result.ok && typeof result.prompt === 'string') {
      setLoad({ phase: 'ready', saved: result.prompt })
      setDraft(result.prompt)
      toast.success(result.prompt ? t('agent.customPrompt.saved') : t('agent.customPrompt.cleared'))
    } else {
      toast.error(result.ok ? t('agent.customPrompt.saveFailed') : errorMessage(result.error))
    }
  }

  const heading = (
    <div>
      <h2 className="text-[13px] font-semibold text-text">{t('agent.customPrompt.title')}</h2>
      <p className="mt-0.5 text-[12px] text-text-muted">
        {t('agent.customPrompt.introBefore')}{' '}
        <Tooltip label={t('agent.customPrompt.systemPromptTooltip')}>
          <span className="cursor-help text-text underline decoration-dotted underline-offset-2" tabIndex={0}>
            {t('agent.customPrompt.systemPromptTerm')}
          </span>
        </Tooltip>{' '}
        {t('agent.customPrompt.introAfter')}
      </p>
    </div>
  )

  if (load.phase === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-7 w-48" />
      </div>
    )
  }

  if (load.phase === 'error') {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Callout tone="danger" title={t('agent.customPrompt.loadFailed')}>
          <div className="flex flex-col items-start gap-2">
            <span>{errorMessage(load.error)}</span>
            <Button size="sm" variant="secondary" onClick={retry}>
              {t('agent.customPrompt.retry')}
            </Button>
          </div>
        </Callout>
      </div>
    )
  }

  const state = customPromptEditorState(draft, load.saved)
  const counter = t('agent.customPrompt.counter', {
    count: state.length,
    max: state.max
  })

  return (
    <div className="flex flex-col gap-3">
      {heading}
      <TextArea
        id="custom-system-prompt"
        label={t('agent.customPrompt.label')}
        placeholder={t('agent.customPrompt.placeholder')}
        rows={8}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Mod+Enter saves, the same shortcut the chat composer sends with.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && state.canSave && !saving) {
            e.preventDefault()
            void save(draft)
          }
        }}
        disabled={saving}
        spellCheck
        error={state.over > 0 ? `${t('agent.customPrompt.tooLong', { over: state.over })} ${counter}` : undefined}
        hint={counter}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void save(draft)}
          loading={saving && !confirmingClear}
          disabled={!state.canSave || saving}
        >
          {t('actions.save', { ns: 'common' })}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(load.saved)} disabled={!state.canDiscard || saving}>
          {t('agent.customPrompt.discard')}
        </Button>
        <Button variant="ghost" onClick={() => setConfirmingClear(true)} disabled={!state.canClear || saving}>
          {t('agent.customPrompt.clear')}
        </Button>
      </div>
      <p className="text-[11px] text-text-faint">{t('agent.customPrompt.appliesNote')}</p>

      <ConfirmDialog
        open={confirmingClear}
        title={t('agent.customPrompt.clearConfirmTitle')}
        message={t('agent.customPrompt.clearConfirmMessage')}
        confirmLabel={t('agent.customPrompt.clearConfirm')}
        danger
        loading={saving}
        onConfirm={() => void save('')}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  )
}
