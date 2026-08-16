import { useEffect, useState, type ReactElement } from 'react'
import Welcome from './Welcome'
import ProfileForm from './ProfileForm'
import DocumentUpload from './DocumentUpload'
import StorageModeChoice from './StorageModeChoice'
import McpSetup from './McpSetup'
import { useProfileStore } from '../../state/profileStore'

// Storage mode MUST be chosen before any profile/document data is saved —
// saveProfile/addDocument read the current storage_mode setting at write
// time and don't retroactively re-encrypt anything, so asking afterward
// would silently write everything as plaintext regardless of the choice.
type Step = 'welcome' | 'storage' | 'profile' | 'documents' | 'mcp'

export default function OnboardingFlow({ onComplete }: { onComplete: () => void }): ReactElement {
  const [step, setStep] = useState<Step>('welcome')
  const fetchProfile = useProfileStore((s) => s.fetch)

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const goto = (s: Step): void => setStep(s)

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-canvas-inset p-6">
      {/* my-auto (not justify-center on the scroll container) so tall steps
          stay top-anchored and fully scrollable instead of being clipped
          equally at both edges — centering an overflowing flex child via
          justify-content leaves the portion before the start edge
          unreachable by scroll in some browsers. */}
      <div className="my-auto w-full max-w-2xl border border-border bg-canvas p-5 shadow-pop">
        {step === 'welcome' && <Welcome onNext={() => goto('storage')} />}
        {step === 'storage' && (
          <StorageModeChoice onNext={() => goto('profile')} onBack={() => goto('welcome')} />
        )}
        {step === 'profile' && <ProfileForm onNext={() => goto('documents')} onBack={() => goto('storage')} />}
        {step === 'documents' && (
          <DocumentUpload onNext={() => goto('mcp')} onBack={() => goto('profile')} />
        )}
        {step === 'mcp' && <McpSetup onFinish={onComplete} onBack={() => goto('documents')} />}
      </div>
    </div>
  )
}
