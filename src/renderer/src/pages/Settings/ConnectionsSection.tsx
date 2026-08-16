import { useEffect, useState, type ReactElement } from 'react'
import McpCliCard from '../../components/settings/McpCliCard'
import type { McpConfigDetection } from '@shared/types/ipcEvents'

export default function ConnectionsSection(): ReactElement {
  const [detections, setDetections] = useState<McpConfigDetection[] | null>(null)

  useEffect(() => {
    window.api.onboarding.detectMcpConfigs().then(setDetections)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        JobHunt exposes tools (search, queue, fill applications, etc.) over MCP — connect one or more agent CLIs
        here.
      </p>
      <div className="flex flex-col gap-2">
        {detections === null && <p className="text-[12px] text-text-faint">Detecting installed CLIs…</p>}
        {detections?.map((d) => (
          <McpCliCard key={d.cli} detection={d} />
        ))}
      </div>
    </div>
  )
}
