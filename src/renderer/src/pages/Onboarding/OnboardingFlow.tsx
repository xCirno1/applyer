import { useEffect, useMemo, useState, type ReactElement } from 'react'
import Welcome from './Welcome'
import ProfileForm from './ProfileForm'
import DocumentUpload from './DocumentUpload'
import StorageModeChoice from './StorageModeChoice'
import McpSetup from './McpSetup'
import ReadyStep from './ReadyStep'
import {
  deeperStep,
  isStepReachable,
  maxReachableStep,
  nextStep,
  previousStep,
  type OnboardingStepId
} from './onboardingSteps'
import { OnboardingNavContext, type OnboardingNav } from '../../components/onboarding/OnboardingNavContext'
import { useProfileStore } from '../../state/profileStore'
import type { ProfileFields } from '@shared/types/profile'

/**
 * Owns which step is showing, how deep the user has been, and the profile
 * draft. Everything else each step needs (the detected CLIs, the storage
 * mode, the uploaded documents) is either in the profile store or fetched by
 * the step itself, so nothing has to be threaded through here and back down,
 * including "was the profile skipped?", which the payoff screen derives from
 * the stored profile rather than from a flag that could disagree with it.
 *
 * The draft is the exception, and it is here rather than inside the form
 * because the rail can now leave the profile step mid-sentence: state that
 * lived in the form would be discarded on the way out and the user would
 * come back to an empty form having lost what they typed. Nothing is written
 * to the database until they choose Continue or "I'll fill this later".
 *
 * Step order, reachability and the rail's arithmetic live in
 * `onboardingSteps.ts`.
 */
export default function OnboardingFlow({ onComplete }: { onComplete: () => void }): ReactElement {
  const [step, setStep] = useState<OnboardingStepId>('welcome')
  const [furthest, setFurthest] = useState<OnboardingStepId>('welcome')
  // `null` until the first keystroke, so the form falls through to the
  // stored profile rather than to a snapshot of it: seeding at mount would
  // capture the empty placeholder the store starts on, before the fetch
  // below has resolved. The first edit is built from what is on screen at
  // that moment, which by then is the real thing.
  const [draft, setDraft] = useState<ProfileFields | null>(null)
  const fetchProfile = useProfileStore((s) => s.fetch)
  const profile = useProfileStore((s) => s.profile)
  const documents = useProfileStore((s) => s.documents)

  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile])

  const go = (target: OnboardingStepId): void => {
    setStep(target)
    setFurthest((current) => deeperStep(current, target))
  }

  const goNext = (): void => go(nextStep(step))
  const goBack = (): void => go(previousStep(step))

  const hasResume = documents.some((d) => d.kind === 'resume')
  const nav = useMemo<OnboardingNav>(() => {
    const maxReachable = maxReachableStep(furthest, { hasResume })
    return {
      furthest,
      maxReachable,
      // Re-checked here rather than trusted from the rail: this is the
      // function that actually moves the flow, and a caller that offers a
      // jump it should not have must not be the only thing standing between
      // the user and a step whose requirement is unmet.
      navigate: (target) => {
        if (isStepReachable(target, maxReachable)) setStep(target)
      }
    }
    // `go`/`setStep` are stable; the identity of this object only needs to
    // change when what it permits changes.
  }, [furthest, hasResume])

  return (
    <OnboardingNavContext.Provider value={nav}>
      {step === 'welcome' && <Welcome onNext={goNext} />}
      {step === 'storage' && <StorageModeChoice onNext={goNext} onBack={goBack} />}
      {step === 'profile' && (
        <ProfileForm
          fields={draft ?? profile}
          onFieldsChange={setDraft}
          onNext={goNext}
          onSkip={goNext}
          onBack={goBack}
        />
      )}
      {step === 'documents' && <DocumentUpload onNext={goNext} onBack={goBack} />}
      {step === 'agent' && <McpSetup onNext={goNext} onBack={goBack} />}
      {step === 'ready' && <ReadyStep onFinish={onComplete} onBack={goBack} />}
    </OnboardingNavContext.Provider>
  )
}
