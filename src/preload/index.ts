import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ControlCommand,
  type ControlResult,
  type DownloadNotice,
  type LoadedState,
  type OpenTabRequest,
  type PersistedState,
  type Shortcut
} from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform,
  loadState: (): Promise<LoadedState> => ipcRenderer.invoke(IPC.loadState),
  saveState: (state: PersistedState): void => ipcRenderer.send(IPC.saveState, state),
  saveStateSync: (state: PersistedState): void => {
    ipcRenderer.sendSync(IPC.saveStateSync, state)
  },
  clearSession: (accountId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.clearSession, accountId),
  onOpenTab: (listener: (req: OpenTabRequest) => void) => subscribe(IPC.openTab, listener),
  onShortcut: (listener: (shortcut: Shortcut) => void) => subscribe(IPC.shortcut, listener),

  bindTab: (tabId: string, webContentsId: number): void =>
    ipcRenderer.send(IPC.bindTab, tabId, webContentsId),
  unbindTab: (tabId: string): void => ipcRenderer.send(IPC.unbindTab, tabId),
  onControlCommand: (listener: (command: ControlCommand) => void) =>
    subscribe(IPC.controlCommand, listener),
  sendControlResult: (result: ControlResult): void => ipcRenderer.send(IPC.controlResult, result),
  onAgentActivity: (listener: (tabId: string) => void) => subscribe(IPC.agentActivity, listener),

  onDownloadDone: (listener: (notice: DownloadNotice) => void) => subscribe(IPC.downloadDone, listener),
  showInFolder: (path: string): void => ipcRenderer.send(IPC.showInFolder, path)
}

export type MultiSessionApi = typeof api

contextBridge.exposeInMainWorld('api', api)
