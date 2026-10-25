import { BrowserWindow, dialog, type WebContents } from 'electron'

// Guests the assistant is navigating right now: their "leave page?" prompt is skipped.
const agentNavigating = new Set<number>()

export async function withUnloadAllowed<T>(wc: WebContents, run: () => Promise<T>): Promise<T> {
  agentNavigating.add(wc.id)
  try {
    return await run()
  } finally {
    agentNavigating.delete(wc.id)
  }
}

/**
 * A page with a beforeunload handler (ChatGPT with a draft, webmail compose…) makes
 * Electron silently cancel the navigation unless 'will-prevent-unload' is handled.
 * Ask like Chrome does; when the assistant navigates, just go.
 */
export function guardUnload(contents: WebContents): void {
  contents.on('will-prevent-unload', (event) => {
    if (agentNavigating.has(contents.id)) {
      event.preventDefault()
      return
    }
    const win = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents)
    const options = {
      type: 'question' as const,
      buttons: ['Esci', 'Resta'],
      defaultId: 1,
      cancelId: 1,
      title: 'Uscire dalla pagina?',
      message: 'Uscire dalla pagina?',
      detail: 'Le modifiche che hai fatto potrebbero non essere salvate.'
    }
    const choice = win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options)
    if (choice === 0) event.preventDefault()
  })
}
