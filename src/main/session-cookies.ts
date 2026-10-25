import type { Cookie, CookiesSetDetails, Session } from 'electron'

const KEEP_FOR_SECONDS = 30 * 24 * 60 * 60

function asPersistent(cookie: Cookie): CookiesSetDetails {
  const host = (cookie.domain ?? '').replace(/^\./, '')
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
    name: cookie.name,
    value: cookie.value,
    // Host-only cookies must not get a domain, or they'd widen to subdomains.
    domain: cookie.hostOnly ? undefined : cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: Math.floor(Date.now() / 1000) + KEEP_FOR_SECONDS
  }
}

/**
 * Chromium never writes session cookies (no expiry) to disk, so logins that rely on them
 * (Libero's SSO, for one) are lost when the app closes. Like Chrome's "continue where you
 * left off", every session cookie is re-set as a persistent one. Updates and logouts still
 * work: the site overwrites or deletes the same name/domain/path.
 */
export function keepSessionCookies(ses: Session): void {
  // Chromium flushes the cookie DB lazily (~30 s): flush soon after a login so a crash or
  // kill right afterwards doesn't lose it.
  let flushTimer: NodeJS.Timeout | undefined
  const scheduleFlush = (): void => {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => void ses.cookies.flushStore().catch(() => undefined), 1000)
  }

  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    // A logout must reach the disk too, or a crash would resurrect the cookie.
    if (removed) return scheduleFlush()
    if (!cookie.session) return
    ses.cookies
      .set(asPersistent(cookie))
      .then(scheduleFlush)
      .catch((err) => {
        console.warn(`[cookies] impossibile rendere persistente ${cookie.name}@${cookie.domain}`, err)
      })
  })
}
