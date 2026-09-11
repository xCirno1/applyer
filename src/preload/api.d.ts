import type { ApplyerApi } from './index'
import type { ApplyerSettings } from '@shared/settings'

declare global {
  interface Window {
    api: ApplyerApi
    applyerSettings?: ApplyerSettings
  }
}
