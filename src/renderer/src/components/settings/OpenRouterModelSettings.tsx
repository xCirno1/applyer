import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '../ui/Checkbox'
import Select from '../ui/Select'
import Skeleton from '../ui/Skeleton'
import { useToast } from '../ui/useToast'
import { callIpc } from '../../lib/ipcCall'
import { useErrorMessage } from '../../i18n/formatError'
import { APPLYER_MCP_TOOLS } from '@shared/constants'
import { appError, type AppError } from '@shared/types/errorCodes'
import {
  DEFAULT_OPENROUTER_SETTINGS,
  parseOpenRouterSettings,
  type OpenRouterModel,
  type OpenRouterSettings,
  type ReasoningEffort
} from '@shared/types/openrouter'
import OpenRouterModelPicker from './OpenRouterModelPicker'
import { reconcileReasoningEffort, selectableReasoningEfforts } from './openRouterModelLogic'

type SavingTarget = 'model' | 'effort' | 'tools' | null

/** callIpc's fallback for a rejected bridge call, same shape and reasoning as resumesStore's `BRIDGE_FAILURE`. */
const BRIDGE_FAILURE: { ok: false; error: AppError } = { ok: false, error: appError('unexpected') }

const TOOL_GROUP_ORDER = ['read', 'write', 'form'] as const

interface OpenRouterModelSettingsProps {
  /** The onboarding step omits this (kept short); Settings > Agent shows it. Defaults to shown. */
  showToolApproval?: boolean
}

/**
 * Model + reasoning effort + tool-approval editor for the OpenRouter agent
 * mode, shared by Settings > Agent and the onboarding agent step. Every
 * field saves on change (spinner via disabling the control it belongs to,
 * a success toast, `useErrorMessage()` on failure) rather than needing an
 * explicit Save button, matching `AgentSection`'s auto-start preset.
 *
 * The reasoning-effort Select is re-derived from whichever model
 * `OpenRouterModelPicker` reports as selected (via `onSelectedModel`,
 * which also fires on first load): switching to a model that doesn't
 * support the currently chosen effort silently falls back to `'default'`
 * rather than leaving a value selected that the Select is about to
 * disable it out of reach of.
 */
export default function OpenRouterModelSettings({ showToolApproval = true }: OpenRouterModelSettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const [settings, setSettings] = useState<OpenRouterSettings | null>(null)
  // `undefined` (the initial value) means "the picker hasn't reported the
  // catalog as loaded yet", distinct from `null`, "loaded, and this model
  // isn't in it (or has no reasoning efforts)". The reconciliation effect
  // below must not treat "we don't know yet" as "unsupported", or it would
  // downgrade a perfectly valid persisted `reasoningEffort` to `'default'`
  // on every mount, for the entire window before the catalog answers.
  const [selectedModel, setSelectedModel] = useState<OpenRouterModel | null | undefined>(undefined)
  const [saving, setSaving] = useState<SavingTarget>(null)

  useEffect(() => {
    let cancelled = false
    void callIpc('openrouter.getSettings', () => window.api.openrouter.getSettings(), DEFAULT_OPENROUTER_SETTINGS).then(
      (result) => {
        if (!cancelled) setSettings(parseOpenRouterSettings(result))
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const persist = async (next: OpenRouterSettings, target: SavingTarget): Promise<void> => {
    setSaving(target)
    const result = await callIpc(
      'openrouter.setSettings',
      () => window.api.openrouter.setSettings(next),
      BRIDGE_FAILURE
    )
    setSaving(null)
    if (result.ok) {
      setSettings(result.settings)
      toast.success(t('agent.models.saved'))
    } else {
      setSettings((current) => current ?? next)
      toast.error(result.error ? errorMessage(result.error) : t('agent.models.saveFailed'))
    }
  }

  // Reconciles the reasoning effort whenever the selected model changes
  // (including the very first report from the picker), so a model with no
  // efforts of its own, or one that dropped the previously chosen effort,
  // never leaves the setting pointed at a value the Select can no longer
  // offer.
  useEffect(() => {
    if (!settings || selectedModel === undefined) return
    const selectable = selectableReasoningEfforts(selectedModel?.reasoningEfforts)
    const reconciled = reconcileReasoningEffort(settings.reasoningEffort, selectable)
    if (reconciled !== settings.reasoningEffort) {
      // persist's own setSaving(target) runs before its first await, which
      // the lint rule reads as a synchronous setState: intentional here,
      // reconciling the setting rather than deriving it during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void persist({ ...settings, reasoningEffort: reconciled }, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel])

  if (!settings) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-7 w-48" />
      </div>
    )
  }

  const handleModelChange = (modelId: string): void => {
    if (modelId === settings.modelId) return
    void persist({ ...settings, modelId }, 'model')
  }

  const handleEffortChange = (value: string): void => {
    const effort = value as ReasoningEffort
    if (effort === settings.reasoningEffort) return
    void persist({ ...settings, reasoningEffort: effort }, 'effort')
  }

  const handleToolToggle = (toolName: string, checked: boolean): void => {
    const askFor = checked
      ? [...settings.toolApproval.askFor, toolName]
      : settings.toolApproval.askFor.filter((name) => name !== toolName)
    void persist({ ...settings, toolApproval: { askFor } }, 'tools')
  }

  const selectableEfforts = selectableReasoningEfforts(selectedModel?.reasoningEfforts)
  const effortDisabled = saving === 'effort' || selectableEfforts.length <= 1
  const effortOptions = selectableEfforts.map((effort) => ({ value: effort, label: t(`agent.models.effort.${effort}`) }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">{t('agent.models.modelLabel')}</span>
        <OpenRouterModelPicker
          modelId={settings.modelId}
          onChange={handleModelChange}
          onSelectedModel={setSelectedModel}
          disabled={saving === 'model'}
        />
      </div>

      <div className="max-w-xs" title={selectableEfforts.length <= 1 ? t('agent.models.effortUnsupported') : undefined}>
        <Select
          label={t('agent.models.effortLabel')}
          options={effortOptions}
          value={settings.reasoningEffort}
          onChange={handleEffortChange}
          disabled={effortDisabled}
        />
      </div>

      {showToolApproval && (
        <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
          <div>
            <h3 className="text-[13px] font-semibold text-text">{t('agent.models.toolApprovalTitle')}</h3>
            <p className="mt-0.5 text-[12px] text-text-muted">{t('agent.models.toolApprovalIntro')}</p>
          </div>

          {TOOL_GROUP_ORDER.map((kind) => (
            <div key={kind} className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
                {t(`agent.models.toolGroups.${kind}`)}
              </span>
              <div className="flex flex-col gap-1">
                {APPLYER_MCP_TOOLS.filter((tool) => tool.kind === kind).map((tool) => (
                  <Checkbox
                    key={tool.name}
                    label={tool.name}
                    checked={settings.toolApproval.askFor.includes(tool.name)}
                    onChange={(checked) => handleToolToggle(tool.name, checked)}
                    disabled={saving === 'tools'}
                  />
                ))}
              </div>
            </div>
          ))}

          <p className="text-[11px] text-text-faint">{t('agent.models.toolApprovalNote')}</p>
        </div>
      )}
    </div>
  )
}
