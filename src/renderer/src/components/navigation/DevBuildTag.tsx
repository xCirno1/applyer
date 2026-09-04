import type { ReactElement } from 'react'
import Tag from '../ui/Tag'
import Tooltip from '../ui/Tooltip'
import { useAppInfo } from '../../state/useAppInfo'

/**
 * Marks a window that is running an unpackaged (`npm run dev`) build, which
 * keeps its data in its own `…-dev` userData directory — so a dev window is
 * never mistaken for the installed app while both are open side by side.
 * Renders nothing at all in a packaged build, and nothing while app info is
 * still loading or if it failed to load (a missing marker is the safe
 * default: it only ever appears when we positively know it is a dev build).
 */
export default function DevBuildTag(): ReactElement | null {
  const info = useAppInfo()
  if (!info?.isDevBuild) return null

  return (
    <Tooltip label={`Development build: data is kept in ${info.userDataDir}, separate from the installed app.`}>
      <Tag label="Development Build" tone="warning" />
    </Tooltip>
  )
}
