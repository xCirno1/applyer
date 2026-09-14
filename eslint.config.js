import tseslint from '@electron-toolkit/eslint-config-ts'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['out', 'dist', 'node_modules', 'src/main/db/migrations']
  },
  tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser
    },
    ...reactHooks.configs.flat.recommended
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...reactRefresh.configs.vite()
  },
  {
    // The local test job site is served verbatim to a browser, so it is plain
    // script, not TypeScript; the TS-only rules do not apply to it.
    files: ['test/fixtures/job-site/**/*.js'],
    languageOptions: {
      globals: globals.browser
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  }
)
