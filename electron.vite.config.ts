import { resolve } from 'path'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * drizzle's migrator reads .sql files (and meta/_journal.json) from disk at
 * runtime — they're not pulled in by the bundler, so they must be copied
 * alongside main's output. Implemented as a plain closeBundle hook (rather
 * than vite-plugin-static-copy) because electron-vite 5's Vite-7-environment
 * based build doesn't reliably invoke that plugin's copy step.
 */
function copyMigrationsPlugin(): Plugin {
  return {
    name: 'applyer-copy-migrations',
    apply: 'build',
    closeBundle() {
      const src = resolve(__dirname, 'src/main/db/migrations')
      const dest = resolve(__dirname, 'out/main/migrations')
      if (!existsSync(src)) return
      mkdirSync(dest, { recursive: true })
      cpSync(src, dest, { recursive: true })
      console.log(`[copy-migrations] Copied migrations to ${dest}`)
    }
  }
}

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [externalizeDepsPlugin(), copyMigrationsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        // Forced to CommonJS (with an explicit .cjs extension, since the
        // package is "type": "module") — Electron's sandboxed preload
        // context does not reliably execute ESM preload scripts across
        // versions, and CJS is the universally-supported option.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
