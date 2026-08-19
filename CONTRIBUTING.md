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
npm run smoke:mcp   # exercises the MCP server end to end against a running dev instance
```

All three should pass clean. There's no unit/component test suite yet (see the README's
"Is it ready to use?" section) — the smoke script plus manual testing through the UI is
the current bar.

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
