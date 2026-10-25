import type { WebviewTag } from 'electron'

// Imperative handles to mounted webviews, so the toolbar can drive the active one.
const byTab = new Map<string, WebviewTag>()
const tabByContents = new Map<number, string>()

export const webviews = {
  register(tabId: string, el: WebviewTag): void {
    byTab.set(tabId, el)
  },
  bindContents(tabId: string, webContentsId: number): void {
    tabByContents.set(webContentsId, tabId)
    window.api.bindTab(tabId, webContentsId)
  },
  unregister(tabId: string): void {
    byTab.delete(tabId)
    window.api.unbindTab(tabId)
    for (const [id, t] of tabByContents) if (t === tabId) tabByContents.delete(id)
  },
  get: (tabId: string | null): WebviewTag | undefined => (tabId ? byTab.get(tabId) : undefined),
  tabForContents: (webContentsId: number): string | undefined => tabByContents.get(webContentsId)
}
