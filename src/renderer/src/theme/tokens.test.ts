import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * `tokens.css` is plain CSS, so nothing in the type system stops one palette's
 * values from drifting out of the relationships the design depends on — and a
 * border that lands within a point or two of the surface behind it silently
 * erases the 1px seams the whole app leans on for depth (the light theme
 * shipped with a 90% `border-soft` on a 91% `canvas-inset`, i.e. invisible
 * panel edges). These tests read the real file and assert those relationships
 * in lightness terms, for both palettes.
 */

const CSS = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')

/** Lightness (the third HSL component, in %) of one custom property. */
function lightnessOf(block: string, namePattern: string): number {
  const match = new RegExp(`${namePattern}:\\s*hsl\\(([^)]*)\\)`).exec(block)
  if (!match) throw new Error(`${namePattern} is not declared as an hsl() value in this palette`)
  const value = match[1] ?? ''
  const lightness = Number.parseFloat(value.trim().split(/[\s,]+/)[2] ?? '')
  if (!Number.isFinite(lightness)) {
    throw new Error(`${namePattern} has no parseable lightness in "hsl(${value})"`)
  }
  return lightness
}

/** The body of a rule, given the text its selector starts with. */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} rule in tokens.css`)
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('}', open)
  if (open === -1 || close === -1) throw new Error(`unterminated ${selector} rule`)
  return CSS.slice(open + 1, close)
}

// Both palettes ramp the same way — elevation means lighter, so `raised` is
// the lightest surface in either theme. What flips is everything that has to
// contrast *away* from the ramp: seams and text sit past its light end in the
// dark theme and past its dark end in the light one. `contrast` is that sign.
const PALETTES = [
  { name: 'dark', css: ruleBody('@theme'), contrast: 1 },
  { name: 'light', css: ruleBody(":root[data-theme='light']"), contrast: -1 }
]

describe.each(PALETTES)('$name palette', ({ css, contrast }) => {
  // `--color-canvas` needs the lookahead so it doesn't match `--color-canvas-soft`.
  const RAMP = [
    { name: '--color-canvas-inset', pattern: '--color-canvas-inset' },
    { name: '--color-canvas', pattern: '--color-canvas(?!-)' },
    { name: '--color-canvas-soft', pattern: '--color-canvas-soft' },
    { name: '--color-canvas-raised', pattern: '--color-canvas-raised' }
  ]
  const surfaces = RAMP.map((step) => ({ name: step.name, lightness: lightnessOf(css, step.pattern) }))
  const lightest = surfaces[surfaces.length - 1]
  const darkest = surfaces[0]
  const canvas = surfaces[1]
  if (!lightest || !darkest || !canvas) throw new Error('the surface ramp lost a step')

  it('ramps inset -> canvas -> soft -> raised, each step a visible amount apart', () => {
    surfaces.forEach((surface, i) => {
      const previous = surfaces[i - 1]
      if (!previous) return
      const step = surface.lightness - previous.lightness
      expect(step, `${surface.name} must sit a step past ${previous.name}`).toBeGreaterThanOrEqual(2)
    })
  })

  it('keeps both border tokens clear of every surface in the ramp', () => {
    // Seams read by contrasting away from the ramp: lighter than every surface
    // in the dark theme, darker than every surface in the light one. Checking
    // the far end of the ramp covers the other three surfaces by construction.
    const nearest = (contrast === 1 ? lightest : darkest).lightness
    for (const token of ['--color-border-soft', '--color-border']) {
      const gap = (lightnessOf(css, token) - nearest) * contrast
      expect(gap, `${token} must contrast against the nearest surface`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the full-strength border stronger than the soft divider', () => {
    const gap = (lightnessOf(css, '--color-border') - lightnessOf(css, '--color-border-soft')) * contrast
    expect(gap).toBeGreaterThan(0)
  })

  it('separates text from the surface it sits on', () => {
    // Text runs opposite the surfaces: light on dark, dark on light.
    const base = canvas.lightness
    expect((lightnessOf(css, '--color-text') - base) * contrast).toBeGreaterThan(40)
    expect((lightnessOf(css, '--color-text-muted') - base) * contrast).toBeGreaterThan(25)
    expect((lightnessOf(css, '--color-text-faint') - base) * contrast).toBeGreaterThan(15)
  })
})
