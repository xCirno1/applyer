import type { ReactElement } from 'react'
import Button from '../../components/ui/Button'

export default function Welcome({ onNext }: { onNext: () => void }): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">Welcome to JobHunt</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          JobHunt turns a coding assistant running in the built-in terminal (Claude Code, Codex, or any other
          MCP-capable agent) into a job-search assistant. Here&apos;s the shape of it:
        </p>
      </div>
      <ol className="flex flex-col gap-2 text-[13px] text-text-muted">
        <li>
          <span className="font-medium text-text">1. Tell it about yourself.</span> Add your profile and resume next
          — this is what the agent uses to judge fit and fill out applications.
        </li>
        <li>
          <span className="font-medium text-text">2. Ask the agent to find jobs.</span> It searches the web and adds
          matches to a task board here in the app — nothing gets submitted automatically.
        </li>
        <li>
          <span className="font-medium text-text">3. You stay in control.</span> The agent can draft a filled-out
          application for your review, but only you ever click submit.
        </li>
      </ol>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Get started
        </Button>
      </div>
    </div>
  )
}
