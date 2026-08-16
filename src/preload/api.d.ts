import type { ApplyerApi } from './index'

declare global {
  interface Window {
    api: ApplyerApi
  }
}
