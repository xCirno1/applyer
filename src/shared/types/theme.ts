// The renderer's appearance/theme preference (color scheme, accent, canvas
// tint, custom CSS and its saved presets) lives entirely in the renderer's
// localStorage — see renderer/src/theme/theme.ts, which owns parsing,
// persistence, and applying it to the document. The shape and bounds are
// declared here instead so the main process's import validation
// (dataTransfer/importSchema.ts) can check an imported bundle's `theme`
// domain against the exact same limits, without either side duplicating
// the numbers and risking drift.

export type ThemeMode = 'system' | 'light' | 'dark'

/** A user-named snapshot of the custom CSS editor's contents. */
export interface CssPreset {
  id: string
  name: string
  css: string
}

export interface ThemeState {
  mode: ThemeMode
  /** Hex color like "#3c83f6", or null to use the built-in default accent. */
  accent: string | null
  /**
   * Hue in degrees [0, 359] applied to the whole canvas/border ramp in place
   * of its built-in hue, keeping each token's saturation/lightness (and so
   * its contrast ratios) unchanged. Null uses the built-in hue.
   */
  canvasTint: number | null
  /** Raw CSS injected as a <style> tag. Empty string means none. */
  customCss: string
  /** Named snapshots of `customCss` the user has explicitly saved. */
  presets: CssPreset[]
  /** Which preset (if any) `customCss` was last loaded from or saved to. */
  activePresetId: string | null
}

export const MAX_CUSTOM_CSS_LENGTH = 20_000
export const MAX_CSS_PRESETS = 20
export const MAX_PRESET_NAME_LENGTH = 40

export const DEFAULT_THEME_STATE: ThemeState = {
  mode: 'system',
  accent: null,
  canvasTint: null,
  customCss: '',
  presets: [],
  activePresetId: null
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value)
}

export function isValidCanvasTint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 359
}
