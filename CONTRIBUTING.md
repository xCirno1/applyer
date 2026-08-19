# Contributing to Applyer

Thanks for taking a look — contributions, bug reports, and ideas are all welcome.

## Getting set up

```bash
npm install   # also rebuilds native modules (better-sqlite3, node-pty) for Electron
              # and downloads a bundled Chromium for the agent's browser automation
npm run dev   # launches the app in development mode
```

See the [README](README.md) for prerequisites and a walkthrough of how the app works.

## Before you open a PR

```bash
npm run typecheck
npm run lint
npm run test        # unit test suite (Vitest)
npm run smoke:mcp   # exercises the MCP server end to end against a running dev instance
```

All four should pass clean. `npm run test` covers logic and data (job-source parsing,
MCP schemas/tools, database repositories, encryption, config/CLI adapters, renderer
preference logic and state stores) — it does not cover rendered React components yet, so
UI changes still need manual verification through the app (see the README's "Is it ready
to use?" section for the current coverage bar).

When adding logic worth testing, prefer a black-box style: exercise the module's real
exported behavior with real inputs (mocking only genuine boundaries — network, a CLI
subprocess, Electron/OS APIs) rather than mocking the module's own internals. See
`test/mocks/electron.ts` and `src/main/db/testDb.ts` for the shared Electron mock and the
real-migrations SQLite test-database helper most repository/tool tests build on.

## Making changes

- Keep PRs focused — one feature or fix per PR is easier to review than a bundle.
- Follow the existing code organization: reusable UI in `src/renderer/src/components/`
  (see [its own guidelines](src/renderer/src/components/CLAUDE.md) for where new
  components belong), MCP tools in `src/main/mcp-server/tools/`, IPC handlers in
  `src/main/ipc/`.
- Match the design conventions already in the codebase (dense controls, 1px seams over
  shadows, rectangle buttons, no icon backgrounds — see `CLAUDE.md` for the full list) if
  your change touches UI.
- Never assume incoming data (job postings, scraped HTML, agent tool calls) is
  well-formed — validate it and fail into a visible error state rather than crashing.

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/xCirno1/applyer/issues) with as much detail as
you can — steps to reproduce, what you expected, what happened instead, and your OS
(this has mainly been built and tested on Linux so far, so platform-specific reports are
especially useful).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md) — please read it before
participating.
