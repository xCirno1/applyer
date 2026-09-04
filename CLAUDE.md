## Code Guidelines
- Always use production style and compatible code.
- When developing frontend applications, always prioritize user experience (e.g. Use **Skeletons** when loading data/page, **Spinner + disable** when performing actions through a button, etc). And, always consider the layout of the page for mobile.
- Always implement full features, do not use "TODO" or "Pending Implementation".
- Never assume that any received data is valid, always verify. This means that if some data is malfunctioned, the app doesn't break and we receive proper logs.
- Always create reusable UI components in a dedicated directory.
- Use proper error handling for ALL code paths with possible errors.
- Always write tests for core logic, capturing all path and edge-cases.

## Design Guidelines
- For buttons and other clickable elements, use cursor-pointer on hover.
- Use toast notification for success, errors, or any other events.
- Never use the browser's native `confirm()`/`alert()`/`prompt()` dialogs. Use a custom modal for yes/no confirmations (e.g. destructive actions) and a toast for one-way notifications.
- Use tooltips for idiomatic, technical, and potentially unfamiliar words.
- Instead of expanding down for more sections, try expanding to the right and left.
- For collapsible components that require many actions/informations/fields, consider using modal/dedicated page instead.

## Style Guidelines
- Never use icons with background colors and rounded corners.
- Never use blocky UI, i.e. Plain box with rounded corners with some data inside.
- Never use chips with dot on the left side.
- Prioritize rectangle buttons rather than pills. 
- Don't hand-tune radii, type sizes, or spacing to taste.
- Don't use em-dashes.
- **Density is a feature.** Controls are fixed-height (`h-6`/`h-7`), table
  rows are `py-1.5`, panel padding is `px-3`. Whitespace between *sections* should be smaller than you'd use on a content page.
- **Depth comes from 1px seams and the surface ramp**
  (`bg-inset` < `bg` < `bg-soft` < `bg-raised`), not from shadows, glows,
  translucency, or `backdrop-blur`. Panel fills are opaque and panel edges
  use full-strength `border-border`; `border-border-soft` is for dividers
  *inside* a panel. The only two shadows are `shadow-pop` (popovers) and
  `shadow-overlay` (modals) — both for things that genuinely float.
- **Chrome should sit still.** The top bar and the workspace rail are
  opaque bands with hard seams, and everything positioned against the top
  bar reads its height from the `nav` spacing token (`--nav-h`) rather than restating it.

## Performance Guidelines
- For possibly large amount of data, **NEVER** load them directly to a single API fetch/render. Instead, add pagination and/or lazy loading.

## Response Guidelines
- After finishing a run, always suggest the user on what additional features can be implemented next.
- You don't need to start a development server to test, just run simple curls/typecheck/lint is enough.
- If you start it, don't forget to terminate after use.

## Components
Catalog of existing components, organization conventions, and where to add new ones — kept in its own file since it documents the codebase (not agent behavior) and changes independently of the guidelines above.
@src/renderer/src/components/CLAUDE.md
