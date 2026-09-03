// Starter snippets for the custom CSS editor — the "Insert a template…"
// dropdown in AppearanceSection. Each one is meant to be a jumping-off point
// the user edits further, not a finished feature, so they stay short and
// mostly lean on the existing design tokens from theme/tokens.css rather than
// hardcoding colors.

export interface ThemeCssTemplate {
  id: string
  label: string
  description: string
  css: string
}

export const THEME_CSS_TEMPLATES: ThemeCssTemplate[] = [
  {
    id: 'compact',
    label: 'Extra compact',
    description: 'Shrinks the top bar and base font size beyond the default density.',
    css: `/* Extra compact */
:root {
  --spacing-nav: 2.25rem;
}
body {
  font-size: 12px;
}
`
  },
  {
    id: 'high-contrast',
    label: 'High contrast',
    description: 'Punches up border and muted-text contrast for low-vision or bright-room use.',
    css: `/* High contrast */
:root {
  --color-border: hsl(220 10% 45%);
  --color-border-soft: hsl(220 10% 35%);
  --color-text-muted: hsl(220 15% 85%);
  --color-text-faint: hsl(220 15% 70%);
}
/* The light theme needs the same push in the opposite direction —
   without this block, "high contrast" would lighten light-mode text. */
:root[data-theme='light'] {
  --color-border: hsl(220 14% 55%);
  --color-border-soft: hsl(220 14% 65%);
  --color-text-muted: hsl(220 15% 25%);
  --color-text-faint: hsl(220 15% 40%);
}
`
  },
  {
    id: 'larger-text',
    label: 'Larger text',
    description: 'Bumps the base font size up for readability.',
    css: `/* Larger text */
body {
  font-size: 15px;
}
`
  },
  {
    id: 'soft-rounded',
    label: 'Soft rounded corners',
    description: 'Personal touch: this app ships square-cornered by default.',
    css: `/* Soft rounded corners */
button,
input,
textarea,
.border {
  border-radius: 6px;
}
`
  }
]

/** Sentinel value for the "Insert a template…" placeholder option — never a real template id. */
export const TEMPLATE_PLACEHOLDER_ID = '__placeholder__'
