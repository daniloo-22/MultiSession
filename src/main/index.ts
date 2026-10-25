import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  session,
  shell,
  type Input,
  type MenuItemConstructorOptions,
  type TitleBarOverlayOptions,
  type WebContents
} from 'electron'
import { join } from 'node:path'
import {
  IPC,
  partitionFor,
  type OpenTabRequest,
  type DownloadNotice,
  type PersistedState,
  type Shortcut,
  type Theme
} from '@shared/types'
import { createAgentServer } from './agent/server'
import { handleDownloads, isTrackedDownload } from './downloads'
import { keepSessionCookies } from './session-cookies'
import { guardUnload } from './unload-guard'
import { loadState, saveState } from './storage'
import { loadWindowState, trackWindowState } from './window-state'

// Many sites (webmail included) block or degrade when the UA contains "Electron".
function chromeUserAgent(): string {
  const major = process.versions.chrome.split('.')[0]
  const platform =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}
app.userAgentFallback = chromeUserAgent()

// Windows marks a window that is fully covered by others as hidden: Chromium then stops
// painting it and drops real input, which breaks the assistant's clicks and screenshots
// while the user works in another app. Keep it "visible" unless actually minimised.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// Separate profile (state files + sessions) for tests or a second independent setup.
// Must run before the single-instance lock, which is scoped to the userData folder.
if (process.env.MULTISESSION_USER_DATA) app.setPath('userData', process.env.MULTISESSION_USER_DATA)

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let lastState: PersistedState | null = null
const agent = createAgentServer(() => mainWindow)

const isHttpUrl = (value: string | undefined): value is string => {
  if (!value) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

// Native caption buttons (Windows/Linux) drawn over the tab bar: same height and tones,
// kept in sync with the theme. Values mirror --color-chrome / --color-foreground.
const TITLE_BAR_HEIGHT = 48
const titleBarOverlay = (theme: Theme): TitleBarOverlayOptions =>
  theme === 'dark'
    ? { color: '#1e1e1c', symbolColor: '#ebe8e0', height: TITLE_BAR_HEIGHT }
    : { color: '#f1efe8', symbolColor: '#2b2a27', height: TITLE_BAR_HEIGHT }

function persist(state: PersistedState): void {
  const themeChanged = lastState?.preferences.theme !== state.preferences.theme
  lastState = state
  agent.setEnabled(state.preferences.agentAccess)
  if (themeChanged && mainWindow && process.platform !== 'darwin') {
    mainWindow.setTitleBarOverlay(titleBarOverlay(state.preferences.theme))
  }
  try {
    saveState(state)
  } catch (err) {
    console.error('[main] salvataggio stato fallito', err)
  }
}

function shortcutFor(input: Input): Shortcut | null {
  if (input.type !== 'keyDown') return null
  const mod = process.platform === 'darwin' ? input.meta : input.control
  const key = input.key.toLowerCase()
  if (mod && key === 'tab') return input.shift ? 'prev-tab' : 'next-tab'
  if (mod && key === 'pagedown') return 'next-tab'
  if (mod && key === 'pageup') return 'prev-tab'
  if (mod && key === 'w') return 'close-tab'
  if ((mod && key === 'r') || key === 'f5') return 'reload'
  if (mod && key === 'l') return 'focus-url'
  if (input.alt && key === 'arrowleft') return 'back'
  if (input.alt && key === 'arrowright') return 'forward'
  return null
}

// Shortcuts typed while focus is inside a webview never reach the host renderer's DOM.
function forwardShortcuts(contents: WebContents): void {
  contents.on('before-input-event', (event, input) => {
    if (isDev && input.type === 'keyDown' && input.key === 'F12') {
      contents.toggleDevTools()
      return
    }
    const shortcut = shortcutFor(input)
    if (!shortcut || !mainWindow) return
    event.preventDefault()
    mainWindow.webContents.send(IPC.shortcut, shortcut)
  })
}

function requestTab(source: WebContents, url: string, background = false): void {
  if (!mainWindow || !isHttpUrl(url)) return
  const payload: OpenTabRequest = { sourceWebContentsId: source.id, url, background }
  mainWindow.webContents.send(IPC.openTab, payload)
}

function guestContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const history = contents.navigationHistory
    const items: MenuItemConstructorOptions[] = []
    if (isHttpUrl(params.linkURL)) {
      items.push(
        { label: 'Apri link in nuova scheda', click: () => requestTab(contents, params.linkURL) },
        { label: 'Copia indirizzo link', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }
    if (params.isEditable) {
      items.push(
        { label: 'Taglia', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copia', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Incolla', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Seleziona tutto', role: 'selectAll' }
      )
    } else if (params.selectionText) {
      items.push({ label: 'Copia', role: 'copy' })
    }
    if (items.length === 0) {
      items.push(
        { label: 'Indietro', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: 'Avanti', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: 'Ricarica', click: () => contents.reload() }
      )
    }
    if (isDev) {
      items.push(
        { type: 'separator' },
        { label: 'Ispeziona', click: () => contents.inspectElement(params.x, params.y) }
      )
    }
    while (items.at(-1)?.type === 'separator') items.pop()
    Menu.buildFromTemplate(items).popup()
  })
}

// Every account partition is created lazily when its first webview attaches.
app.on('session-created', (ses) => {
  keepSessionCookies(ses)
  handleDownloads(ses, ({ filename, path, state }) => {
    mainWindow?.webContents.send(IPC.downloadDone, { filename, path, state } satisfies DownloadNotice)
  })
})

app.on('web-contents-created', (_event, contents) => {
  forwardShortcuts(contents)
  if (contents.getType() !== 'webview') return

  // The webview 'new-window' event was removed in Electron 22: window.open and
  // target=_blank are intercepted here and turned into a tab in the same partition.
  contents.setWindowOpenHandler(({ url, disposition }) => {
    requestTab(contents, url, disposition === 'background-tab')
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isHttpUrl(url) && url !== 'about:blank') event.preventDefault()
  })

  guestContextMenu(contents)
  guardUnload(contents)
})

function createWindow(initialTheme: Theme): void {
  const { maximized, ...bounds } = loadWindowState()

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'MultiSession',
    backgroundColor: initialTheme === 'dark' ? '#262624' : '#FAF9F5',
    autoHideMenuBar: true,
    // No OS title bar: the tab bar is the title bar, with the native window buttons on it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(initialTheme) }),
    // Packaged builds take the icon from the executable; in dev point at the source file.
    ...(isDev ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: false
    }
  })

  const saveWindowState = trackWindowState(mainWindow)

  mainWindow.once('ready-to-show', () => {
    if (maximized) mainWindow?.maximize()
    mainWindow?.show()
  })

  mainWindow.on('close', () => {
    saveWindowState()
    if (lastState) persist(lastState)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Background tabs keep running timers and rendering, so the assistant can drive them.
    webPreferences.backgroundThrottling = false
    if (!params.partition?.startsWith('persist:') || !isHttpUrl(params.src)) {
      event.preventDefault()
    }
  })

  // The host page itself must never navigate away from the app.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle(IPC.loadState, () => loadState())

ipcMain.on(IPC.saveState, (_event, state: PersistedState) => persist(state))

// Called from the renderer's beforeunload so the last edits land on disk before quitting.
ipcMain.on(IPC.saveStateSync, (event, state: PersistedState) => {
  persist(state)
  event.returnValue = true
})

// Only paths of downloads the app itself saved: the renderer can't reveal arbitrary files.
ipcMain.on(IPC.showInFolder, (_event, path: unknown) => {
  if (typeof path === 'string' && isTrackedDownload(path)) shell.showItemInFolder(path)
})

ipcMain.handle(IPC.clearSession, async (_event, accountId: unknown) => {
  if (typeof accountId !== 'string' || !/^[\w-]+$/.test(accountId)) {
    throw new Error('id account non valido')
  }
  const ses = session.fromPartition(partitionFor(accountId))
  await ses.clearStorageData()
  await ses.clearCache()
})

if (!app.requestSingleInstanceLock()) {
  // Two instances would overwrite each other's state files.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    const { preferences } = loadState()
    createWindow(preferences.theme)
    agent.setEnabled(preferences.agentAccess)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(lastState?.preferences.theme ?? 'light')
      }
    })
  })

  app.on('will-quit', () => agent.stop())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
