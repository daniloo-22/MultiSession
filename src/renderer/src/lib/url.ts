/** Turns what the user typed into a loadable http(s) URL, or null if it can't be one. */
export function normalizeUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.toString()
  } catch {
    return null
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
