import { useEffect, useState, type ReactElement } from 'react'
import Button from '../../components/ui/Button'
import McpCliCard from '../../components/settings/McpCliCard'
import type { McpConfigDetection } from '@shared/types/ipcEvents'

export default function McpSetup({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }): ReactElement {
  const [detections, setDetections] = useState<McpConfigDetection[] | null>(null)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    window.api.onboarding.detectMcpConfigs().then(setDetections)
  }, [])

  const handleFinish = async (): Promise<void> => {
    setFinishing(true)
    await window.api.onboarding.complete()
    setFinishing(false)
    onFinish()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">Connect your agent</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          JobHunt exposes tools (search, queue, etc.) over MCP — a standard way for coding agents to call into an
          app. Set this up once per agent, either automatically or by copying the command below into its config.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {detections === null && <p className="text-[12px] text-text-faint">Detecting installed CLIs…</p>}
        {detections?.map((d) => (
          <McpCliCard key={d.cli} detection={d} />
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={handleFinish} loading={finishing}>
          Finish
        </Button>
      </div>
    </div>
  )
}
