/// <reference lib="dom" />
// These functions are serialised with Function.prototype.toString() and run inside the
// guest page (isolated world): they must be self-contained, no imports or outer references.

export interface PageScriptArgs {
  filter?: 'interactive' | 'all'
  maxChars?: number
  query?: string
  ref?: string
  x?: number
  y?: number
  dx?: number
  dy?: number
}

/** Shared bootstrap: ref registry + element description helpers, kept on the isolated world's globalThis. */
export function pageAgent(args: PageScriptArgs & { op: string }): unknown {
  type Agent = {
    next: number
    refs: Map<string, WeakRef<Element>>
    ids: WeakMap<Element, string>
  }
  const g = globalThis as unknown as { __msAgent?: Agent }
  const agent: Agent = (g.__msAgent ??= { next: 1, refs: new Map(), ids: new WeakMap() })

  const refFor = (el: Element): string => {
    let id = agent.ids.get(el)
    if (!id) {
      id = `ref_${agent.next++}`
      agent.ids.set(el, id)
      agent.refs.set(id, new WeakRef(el))
    }
    return id
  }

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'textbox', 'searchbox', 'combobox', 'switch', 'slider', 'spinbutton', 'treeitem', 'gridcell'
  ])
  const LANDMARKS: Record<string, string> = {
    nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
    form: 'form', dialog: 'dialog', section: 'region', table: 'table', ul: 'list', ol: 'list'
  }

  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit.split(' ')[0]
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
      if (type === 'hidden') return null
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'range') return 'slider'
      if (type === 'search') return 'searchbox'
      return 'textbox'
    }
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'img') return el.getAttribute('alt') ? 'img' : null
    if (tag === 'li') return 'listitem'
    if (tag === 'tr') return 'row'
    if (tag === 'label') return 'label'
    if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox'
    return LANDMARKS[tag] ?? null
  }

  // Webmail message rows are often plain divs with a click handler: catch them via
  // tabindex, onclick or a pointer cursor that doesn't just inherit from the parent.
  const clickable = (el: Element): boolean => {
    const tabindex = el.getAttribute('tabindex')
    if (tabindex !== null && Number(tabindex) >= 0) return true
    if (el.hasAttribute('onclick')) return true
    if ((el as HTMLElement).isContentEditable && el.hasAttribute('contenteditable')) return true
    const parent = el.parentElement
    return (
      getComputedStyle(el).cursor === 'pointer' &&
      (!parent || getComputedStyle(parent).cursor !== 'pointer')
    )
  }

  const effectiveRole = (el: Element): string | null => roleOf(el) ?? (clickable(el) ? 'clickable' : null)

  const isInteractive = (role: string | null): boolean =>
    role !== null && (INTERACTIVE_ROLES.has(role) || role === 'clickable')

  // Leaf controls: their name already contains their text, so their subtree is skipped.
  const LEAF = new Set([
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'textbox', 'searchbox', 'combobox', 'switch', 'slider', 'spinbutton', 'img'
  ])

  // Only what is really not rendered is skipped. aria-hidden (modal dialogs hide the rest
  // of the page that way) and opacity 0 (hover-revealed buttons) are still on screen and clickable.
  const visible = (el: Element): boolean => {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  const clean = (s: string | null | undefined, max = 100): string => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim()
    return t.length > max ? `${t.slice(0, max - 1)}…` : t
  }

  const nameOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const text = labelledby
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
      if (text.trim()) return clean(text)
    }
    const html = el as HTMLInputElement
    if (el.id && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (label?.textContent?.trim()) return clean(label.textContent)
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const wrapping = el.closest('label')
      if (wrapping?.textContent?.trim()) return clean(wrapping.textContent)
      if (!html.placeholder && el.getAttribute('name')) return clean(el.getAttribute('name'))
    }
    return clean(
      el.getAttribute('alt') ||
        el.getAttribute('title') ||
        html.placeholder ||
        (el instanceof HTMLElement ? el.innerText : el.textContent) ||
        ''
    )
  }

  const describe = (el: Element, role: string): string => {
    const parts = [role]
    const name = nameOf(el)
    if (name) parts.push(JSON.stringify(name))
    if (role === 'heading') parts.push(`level=${el.tagName[1] ?? el.getAttribute('aria-level') ?? ''}`)
    const input = el as HTMLInputElement
    if ((role === 'textbox' || role === 'searchbox' || role === 'combobox') && 'value' in input && input.value) {
      parts.push(`value=${JSON.stringify(clean(input.value, 60))}`)
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      const checked = input.checked ?? el.getAttribute('aria-checked') === 'true'
      parts.push(checked ? 'checked' : 'unchecked')
    }
    if (el.getAttribute('aria-selected') === 'true') parts.push('selected')
    if (el.getAttribute('aria-expanded')) parts.push(`expanded=${el.getAttribute('aria-expanded')}`)
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled')
    if (role === 'link') {
      const href = el.getAttribute('href')
      if (href && !href.startsWith('javascript:')) parts.push(`href=${JSON.stringify(clean(href, 80))}`)
    }
    return `${parts.join(' ')} [${refFor(el)}]`
  }

  const children = (el: Element): Element[] => [
    ...(el.shadowRoot ? Array.from(el.shadowRoot.children) : []),
    ...Array.from(el.children)
  ]

  const ownText = (el: Element): string =>
    clean(
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(' '),
      160
    )

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'META', 'LINK'])

  if (args.op === 'read') {
    const all = args.filter === 'all'
    const max = args.maxChars ?? 30000
    const lines: string[] = []
    let size = 0
    let truncated = false
    const walk = (el: Element, depth: number): void => {
      if (truncated || SKIP.has(el.tagName.toUpperCase())) return
      if (!visible(el) && el !== document.body) return
      const role = effectiveRole(el)
      let shown = false
      if (role && (all || isInteractive(role) || role === 'heading' || role === 'dialog' || role === 'main')) {
        const line = `${'  '.repeat(depth)}${describe(el, role)}`
        lines.push(line)
        size += line.length + 1
        shown = true
        if (LEAF.has(role)) return
      } else if (all) {
        const text = ownText(el)
        if (text) {
          const line = `${'  '.repeat(depth)}text ${JSON.stringify(text)}`
          lines.push(line)
          size += line.length + 1
        }
      }
      if (size > max) {
        truncated = true
        return
      }
      for (const child of children(el)) walk(child, depth + (shown ? 1 : 0))
    }
    walk(document.body, 0)
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY) },
      tree: lines.join('\n') + (truncated ? '\n… (troncato: usa find o aumenta max_chars)' : '')
    }
  }

  if (args.op === 'find') {
    const q = (args.query ?? '').toLowerCase().trim()
    const out: string[] = []
    const walk = (el: Element): void => {
      if (out.length >= 25 || SKIP.has(el.tagName.toUpperCase()) || !visible(el)) return
      const role = effectiveRole(el)
      const name = role ? nameOf(el).toLowerCase() : ''
      const extra = [el.getAttribute('placeholder'), el.getAttribute('name'), el.id, role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (role && (name.includes(q) || extra.includes(q))) {
        out.push(describe(el, role))
        if (LEAF.has(role)) return
      } else if (!role && ownText(el).toLowerCase().includes(q)) {
        out.push(`text ${JSON.stringify(ownText(el))} [${refFor(el)}]`)
      }
      for (const child of children(el)) walk(child)
    }
    walk(document.body)
    return out
  }

  if (args.op === 'locate') {
    const el = agent.refs.get(args.ref ?? '')?.deref()
    if (!el || !el.isConnected) return { error: `${args.ref} non esiste più: rileggi la pagina con read_page o find` }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }

  if (args.op === 'focus') {
    const el = agent.refs.get(args.ref ?? '')?.deref() as HTMLElement | undefined
    if (!el || !el.isConnected) return { error: `${args.ref} non esiste più: rileggi la pagina con read_page o find` }
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    el.focus()
    return { ok: true }
  }

  if (args.op === 'select-all') {
    const el = document.activeElement as HTMLInputElement | null
    if (el && typeof el.select === 'function') el.select()
    else document.execCommand('selectAll')
    return { ok: true }
  }

  if (args.op === 'text') {
    const max = args.maxChars ?? 20000
    const root =
      document.querySelector('main, [role=main], article') ?? document.body
    const text = (root as HTMLElement).innerText.replace(/\n{3,}/g, '\n\n').trim()
    return {
      url: location.href,
      title: document.title,
      text: text.length > max ? `${text.slice(0, max)}\n… (troncato a ${max} caratteri)` : text
    }
  }

  if (args.op === 'scroll') {
    // Scroll the nearest scrollable container under the point (message lists, reading
    // panes…), falling back to the page itself.
    const canScroll = (el: Element): boolean => {
      const style = getComputedStyle(el)
      const y = /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
      const x = /(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1
      return (args.dy ? y : false) || (args.dx ? x : false)
    }
    let el: Element | null = document.elementFromPoint(args.x ?? innerWidth / 2, args.y ?? innerHeight / 2)
    while (el && el !== document.body && el !== document.documentElement && !canScroll(el)) el = el.parentElement
    const target = el && el !== document.body && el !== document.documentElement ? el : document.scrollingElement
    if (!target) return { error: 'niente da scorrere' }
    const before = { top: target.scrollTop, left: target.scrollLeft }
    target.scrollBy({ top: args.dy ?? 0, left: args.dx ?? 0, behavior: 'instant' })
    return {
      moved: target.scrollTop !== before.top || target.scrollLeft !== before.left,
      scrollTop: Math.round(target.scrollTop),
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight
    }
  }

  if (args.op === 'probe-install') {
    // Records whether real (trusted) input reaches the page: if the window is hidden or
    // occluded, Chromium silently drops it and the caller falls back to DOM events.
    const probe = { pointer: false, key: false }
    const onPointer = (e: Event): void => {
      if (e.isTrusted) probe.pointer = true
    }
    const onKey = (e: Event): void => {
      if (e.isTrusted) probe.key = true
    }
    addEventListener('pointerdown', onPointer, true)
    addEventListener('mousedown', onPointer, true)
    addEventListener('keydown', onKey, true)
    ;(agent as Agent & { probe?: unknown }).probe = {
      probe,
      stop: () => {
        removeEventListener('pointerdown', onPointer, true)
        removeEventListener('mousedown', onPointer, true)
        removeEventListener('keydown', onKey, true)
      }
    }
    return { ok: true }
  }

  if (args.op === 'probe-read') {
    const holder = agent as Agent & { probe?: { probe: { pointer: boolean; key: boolean }; stop: () => void } }
    // No probe here means the document was replaced: the input did something (navigation).
    if (!holder.probe) return { pointer: true, key: true, navigated: true }
    const result = holder.probe.probe
    holder.probe?.stop()
    holder.probe = undefined
    return result
  }

  if (args.op === 'hit') {
    // What a click at x,y would land on, for diagnostics.
    const el = document.elementFromPoint(args.x ?? 0, args.y ?? 0)
    if (!el) return { label: 'niente (fuori dalla pagina)' }
    const target = el.closest('button, a, [role], input, textarea, select, [contenteditable]') ?? el
    const role = effectiveRole(target) ?? target.tagName.toLowerCase()
    const name = nameOf(target)
    return { label: name ? `${role} ${JSON.stringify(name)}` : role }
  }

  if (args.op === 'field-text') {
    const el = document.activeElement as HTMLInputElement | HTMLElement | null
    if (!el) return { text: '' }
    return { text: 'value' in el && typeof el.value === 'string' ? el.value : (el as HTMLElement).innerText ?? '' }
  }

  if (args.op === 'dom-enter') {
    // Untrusted Enter for editors that ignore keys not delivered by the OS (hidden window).
    const el = (document.activeElement ?? document.body) as HTMLElement
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }
    el.dispatchEvent(new KeyboardEvent('keydown', init))
    el.dispatchEvent(new KeyboardEvent('keypress', init))
    el.dispatchEvent(new KeyboardEvent('keyup', init))
    return { ok: true }
  }

  if (args.op === 'activate') {
    // Click without real mouse input (window minimised): full event sequence, then the
    // element's own activation, so links, buttons and download links all react.
    const el = (args.ref
      ? agent.refs.get(args.ref)?.deref()
      : document.elementFromPoint(args.x ?? 0, args.y ?? 0)) as HTMLElement | null | undefined
    if (!el || !el.isConnected) return { error: `${args.ref ?? 'punto'} non trovato: rileggi la pagina con read_page o find` }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mousedown', at))
    el.focus?.()
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mouseup', at))
    el.click()
    return { x: Math.round(at.clientX), y: Math.round(at.clientY) }
  }

  if (args.op === 'source') {
    // The file behind an element: image, link, video/audio, or a CSS background.
    const el = agent.refs.get(args.ref ?? '')?.deref()
    if (!el || !el.isConnected) return { error: `${args.ref} non esiste più: rileggi la pagina con read_page o find` }
    const media = (el.matches('img, video, audio, source, a[href]') ? el : el.querySelector('img, video, a[href]')) as
      | (HTMLImageElement & HTMLAnchorElement & HTMLMediaElement)
      | null
    const fromMedia = media && (media.currentSrc || media.src || media.href)
    if (fromMedia) return { url: fromMedia }
    const bg = getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/)
    if (bg) return { url: new URL(bg[1], location.href).href }
    return { error: `${args.ref} non contiene un'immagine, un link o un media da scaricare` }
  }

  if (args.op === 'viewport') return { width: innerWidth, height: innerHeight }

  return { error: `operazione sconosciuta: ${args.op}` }
}
