import type { MultiSessionApi } from './index'

declare global {
  interface Window {
    api: MultiSessionApi
  }
}
