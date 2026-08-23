import type { ReactElement } from 'react'
import Button from '../../components/ui/Button'

/**
 * The Export/Import modals themselves are mounted once at `App.tsx`'s
 * `MainShell` level (like `JobDetailModal`) rather than here, since the
 * File menu's "Export Data…"/"Import Data…" items need to pop them
 * directly without first navigating to this section — this component just
 * triggers the same open callbacks the menu items use.
 */
export default function DataSection({
  onOpenExport,
  onOpenImport
}: {
  onOpenExport: () => void
  onOpenImport: () => void
}): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        Everything here stays on this computer — export writes a file you choose, import reads one you pick.
      </p>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col items-start gap-2 border border-border-soft p-3">
          <h2 className="text-[13px] font-semibold text-text">Export</h2>
          <p className="text-[12px] text-text-muted">
            Save your job applications, exclusions, profile, and settings to a file — as one JSON bundle, or as a CSV
            table for spreadsheets.
          </p>
          <Button size="sm" onClick={onOpenExport}>
            Export…
          </Button>
        </div>

        <div className="flex flex-1 flex-col items-start gap-2 border border-border-soft p-3">
          <h2 className="text-[13px] font-semibold text-text">Import</h2>
          <p className="text-[12px] text-text-muted">
            Restore data from a JSON file this app exported. New jobs and exclusions are added alongside what you
            already have; profile and settings can optionally be overwritten.
          </p>
          <Button size="sm" onClick={onOpenImport}>
            Import…
          </Button>
        </div>
      </div>
    </div>
  )
}
