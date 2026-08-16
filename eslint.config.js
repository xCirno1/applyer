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
  }
)
