import type { ReactElement } from 'react'
import KanbanBoard from '../../components/board/KanbanBoard'

export default function BoardPage(): ReactElement {
  return (
    <div className="h-full bg-canvas-inset">
      <KanbanBoard />
    </div>
  )
}
