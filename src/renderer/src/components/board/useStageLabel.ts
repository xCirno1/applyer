import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApplicationStage } from '@shared/types/applicationStage'
import { builtinStageKey } from '../../state/stagesStoreLogic'

/**
 * The name a stage is shown under on screen: a built-in's translation, or
 * a custom stage's own label exactly as typed. `null` is "no stage". One
 * hook so the card, the filter, the overview, the picker and the manager
 * cannot disagree about what a stage is called.
 */
export function useStageLabel(): (stage: Pick<ApplicationStage, 'id' | 'label' | 'isBuiltin'> | null) => string {
  const { t } = useTranslation('board')
  return useCallback(
    (stage) => {
      if (!stage) return t('stages.none')
      const key = builtinStageKey(stage)
      return key ? t(`stages.builtin.${key}`) : stage.label
    },
    [t]
  )
}
