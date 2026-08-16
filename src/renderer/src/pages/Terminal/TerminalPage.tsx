import type { ReactElement } from 'react'
import TerminalPane from '../../components/terminal/TerminalPane'

export default function TerminalPage(): ReactElement {
  return (
    <div className="h-full bg-canvas-raised">
      <TerminalPane />
    </div>
  )
}
