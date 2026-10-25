import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import type { WebContents } from 'electron'
import { uniquePath } from '../downloads'

const MAX_BYTES = 200 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/svg+xml': '.svg', 'image/avif': '.avif', 'application/pdf': '.pdf', 'video/mp4': '.mp4',
  'video/webm': '.webm', 'audio/mpeg': '.mp3', 'application/zip': '.zip', 'application/json': '.json',
  'text/plain': '.txt', 'text/csv': '.csv'
}

export class SaveError extends Error {}

interface Fetched {
  bytes: Buffer
  mime: string
  suggestedName?: string
}

// Runs in the page's main world: blob: URLs only resolve in the document that created
// them, and same-origin fetches carry exactly the page's cookies and Cloudflare state.
const IN_PAGE_FETCH = `async (url, max) => {
  const res = await fetch(url)
  if (!res.ok) return { error: 'HTTP ' + res.status }
  const blob = await res.blob()
  if (blob.size > max) return { error: 'file troppo grande (' + blob.size + ' byte)' }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mime: blob.type, data: btoa(bin), disposition: res.headers.get('content-disposition') }
}`

const filenameFromDisposition = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined
  const star = value.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (star) return decodeURIComponent(star[1].replace(/["']/g, ''))
  return value.match(/filename="?([^";]+)"?/i)?.[1]
}

async function fetchInPage(wc: WebContents, url: string): Promise<Fetched> {
  const r = (await wc.executeJavaScript(`(${IN_PAGE_FETCH})(${JSON.stringify(url)}, ${MAX_BYTES})`, true)) as {
    error?: string
    mime?: string
    data?: string
    disposition?: string | null
  }
  if (r.error || !r.data) throw new SaveError(r.error ?? 'risposta vuota')
  return {
    bytes: Buffer.from(r.data, 'base64'),
    mime: (r.mime ?? '').split(';')[0],
    suggestedName: filenameFromDisposition(r.disposition)
  }
}

// Main-process fetch inside the account's partition: has its cookies, and works for
// cross-origin files that the page itself couldn't read because of CORS.
async function fetchInSession(wc: WebContents, url: string): Promise<Fetched> {
  const res = await wc.session.fetch(url, { credentials: 'include' })
  if (!res.ok) throw new SaveError(`HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new SaveError(`file troppo grande (${bytes.length} byte)`)
  return {
    bytes,
    mime: (res.headers.get('content-type') ?? '').split(';')[0],
    suggestedName: filenameFromDisposition(res.headers.get('content-disposition'))
  }
}

async function download(wc: WebContents, url: string): Promise<Fetched> {
  if (url.startsWith('blob:') || url.startsWith('data:')) return fetchInPage(wc, url)
  const sameOrigin = (() => {
    try {
      return new URL(url).origin === new URL(wc.getURL()).origin
    } catch {
      return false
    }
  })()
  const [first, second] = sameOrigin ? [fetchInPage, fetchInSession] : [fetchInSession, fetchInPage]
  try {
    return await first(wc, url)
  } catch (err) {
    try {
      return await second(wc, url)
    } catch {
      throw err
    }
  }
}

function targetPath(requested: string, fetched: Fetched, url: string, overwrite: boolean): string {
  if (!isAbsolute(requested)) throw new SaveError('path deve essere un percorso assoluto, es. C:\\Users\\…\\immagine.png')
  const full = resolve(requested)
  const isDir = /[\\/]$/.test(requested) || (() => {
    try {
      return statSync(full).isDirectory()
    } catch {
      return false
    }
  })()

  const dir = isDir ? full : dirname(full)
  let name = isDir ? '' : basename(full)
  if (!name) {
    const fromUrl = (() => {
      try {
        return decodeURIComponent(basename(new URL(url).pathname))
      } catch {
        return ''
      }
    })()
    name = fetched.suggestedName || (url.startsWith('blob:') || url.startsWith('data:') ? '' : fromUrl) || 'download'
  }
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  if (!extname(name) && EXT_BY_MIME[fetched.mime]) name += EXT_BY_MIME[fetched.mime]

  mkdirSync(dir, { recursive: true })
  return overwrite ? resolve(dir, name) : uniquePath(dir, name)
}

export async function saveFile(
  wc: WebContents,
  url: string,
  requestedPath: string,
  overwrite: boolean
): Promise<{ path: string; bytes: number; mime: string }> {
  const fetched = await download(wc, url)
  const path = targetPath(requestedPath, fetched, url, overwrite)
  writeFileSync(path, fetched.bytes)
  return { path, bytes: fetched.bytes.length, mime: fetched.mime || 'sconosciuto' }
}
