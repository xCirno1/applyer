import type { JobHuntApi } from './index'

declare global {
  interface Window {
    api: JobHuntApi
  }
}
