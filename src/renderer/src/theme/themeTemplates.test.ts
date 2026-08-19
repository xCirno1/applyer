import { describe, it, expect } from 'vitest'
import { THEME_CSS_TEMPLATES, TEMPLATE_PLACEHOLDER_ID } from './themeTemplates'

describe('THEME_CSS_TEMPLATES', () => {
  it('has unique, non-empty ids and non-empty CSS for every template', () => {
    const ids = THEME_CSS_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const template of THEME_CSS_TEMPLATES) {
      expect(template.id.length).toBeGreaterThan(0)
      expect(template.label.length).toBeGreaterThan(0)
      expect(template.css.trim().length).toBeGreaterThan(0)
    }
  })

  it('never uses the placeholder sentinel as a real template id', () => {
    expect(THEME_CSS_TEMPLATES.some((t) => t.id === TEMPLATE_PLACEHOLDER_ID)).toBe(false)
  })
})
