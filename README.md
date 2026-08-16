# Applyer

A local Electron app that turns a coding assistant running in a built-in terminal (Claude Code, Codex CLI, or any other MCP-capable agent) into a job-search assistant.

You keep your profile and resume in the app. The agent searches the web for matching jobs, adds them to a task board here, and can draft a filled-out application for a posting — but it never submits anything. You review every application and click submit yourself.

## How it works

1. **Tell it about yourself.** Onboarding walks you through a profile (contact info, desired roles, skills, salary expectations) and your resume/cover letter documents. You choose whether this is stored encrypted (OS keychain-backed) or plaintext on disk.
2. **Connect an agent.** Onboarding detects installed MCP-capable CLIs (currently Claude Code and Codex CLI) and can auto-configure the connection for you, or give you a config snippet to add manually.
3. **Ask the agent to job hunt**, from the terminal built into the app. It calls back into Applyer over MCP to search, inspect postings, and manage your board.
4. **Review on the board.** Matches land in a Kanban board (Queued → Filled → Submitted, plus Failed) that updates live as the agent works.

## Prerequisites

- Node.js 20+ and npm
- Linux, macOS, or Windows (Linux is what this has actually been built and tested on so far)
- At least one MCP-capable CLI installed and authenticated — e.g. [Claude Code](https://claude.com/claude-code) (`npm install -g @anthropic-ai/claude-code`) or Codex CLI
- On Linux, a display server (X11/Wayland) — the app is a normal Electron GUI app, not headless

## Setup

```bash
npm install   # also rebuilds native modules (better-sqlite3, node-pty) for Electron
              # and downloads a bundled Chromium for the agent's browser automation
npm run dev   # launches the app in development mode
```

First launch takes you through onboarding (profile → documents → storage mode → connect a CLI). This only happens once — subsequent launches go straight to the board.

## Using it day to day

1. Open the app.
2. Go to the **Terminal** tab and start your agent, e.g. type `claude` and hit enter.
3. Ask it something like: *"Search for remote backend engineer roles and queue anything that's a good match for my profile."*
4. Switch to the **Board** tab to watch matches show up, open a job for full details, and (once the agent has drafted a fill) review and submit the application yourself from the browser window it opens.

The agent only has the tools it needs for this workflow — it can't do anything else in the app or on your machine beyond what's listed below.

## What the agent can do (MCP tools)

| Tool | Purpose |
|---|---|
| `get_profile` | Reads your profile and document list, to judge fit and fill forms. |
| `search_jobs` | Keyword search across LinkedIn and Indeed. |
| `get_job_details` | Full posting details for a specific URL (Greenhouse/Lever/Ashby via API, others via headless browser). |
| `queue_job` | Adds a posting to your board (deduplicated by URL). |
| `list_jobs` | Lists what's already on the board, to avoid re-queuing. |
| `flag_failure` | Marks a job Failed with a reason (e.g. login required, listing expired). |
| `fill_application` | Opens a visible browser, fills the standard fields from your profile — never submits. Pauses and surfaces a banner in the app if it hits a verification challenge. |

## Other useful scripts

```bash
npm run build       # production build (out/)
npm run package      # build + package into a distributable (release/) via electron-builder
npm run typecheck    # tsc, no emit
npm run lint          # eslint
npm run smoke:mcp    # exercises the MCP server end-to-end against a running dev instance
```

## Is it ready to use?

Yes, for personal, single-user use on Linux. Concretely, what's been verified:

- Full onboarding → profile/documents → storage mode (encrypted or plaintext, switchable later from Settings) → MCP connection, working end to end.
- All seven MCP tools pass a scripted protocol smoke test (`npm run smoke:mcp`), including validation/error paths, against both dev mode and a packaged build.
- The **packaged app** (`npm run package`) was built, launched standalone, and driven through the real MCP bridge exactly as an installed CLI would — including a live `search_jobs` call that launched the bundled Chromium and returned real Indeed results. Two packaging-specific bugs (a display-server crash in the MCP bridge process, and an asar/Playwright incompatibility) were found and fixed this way, not just inferred from config.
- Typecheck, lint, and build are all clean.

What to know before relying on it further:

- **No automated test suite** beyond the MCP smoke script and manual verification — no unit/component tests exist yet.
- **Only exercised on Linux.** The `mac`/`win` electron-builder targets are configured but never actually built or run.
- **Not code-signed**, and `electron-updater` is a dependency but auto-update isn't wired up — packaged builds won't self-update.
- It hasn't yet been used for a real, complete job search by a human end to end (real accounts, real applications) — only smoke-tested and dogfooded during development.

For getting a coding agent to help you look for jobs on your own machine, it's in good enough shape to start using today. Treat a packaged build on macOS/Windows as unverified until someone actually builds and runs one there.
