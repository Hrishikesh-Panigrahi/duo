import { useEffect, useReducer, useState } from 'react'

/** Keeps --app-h equal to the visible height: on iOS the keyboard shrinks only the visual viewport. */
export function trackViewportHeight() {
  const vv = window.visualViewport
  if (!vv) return
  const update = () => {
    document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height * vv.scale)}px`)
    if (vv.offsetTop > 0 && vv.scale === 1) window.scrollTo(0, 0)
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  update()
}

export const isTouch = () => window.matchMedia('(pointer: coarse)').matches

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number'])

function isTextEntry(el: Element | null) {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type)
  return (el as HTMLElement).isContentEditable === true
}

/** True while an on-screen keyboard covers the screen. Focus alone isn't enough: desktops focus fields too. */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    return vv ? watchKeyboard(vv, setOpen) : undefined
  }, [])
  return open
}

/** Returns a function that stops watching. */
function watchKeyboard(vv: VisualViewport, onChange: (open: boolean) => void): () => void {
  // The tallest the visible area has been at this width: rotating changes the width, a keyboard doesn't.
  let width = window.innerWidth
  let tallest = 0
  const update = () => {
    if (window.innerWidth !== width) {
      width = window.innerWidth
      tallest = 0
    }
    const height = vv.height * vv.scale // ignore pinch-zoom
    tallest = Math.max(tallest, height)
    // Keyboards take well over a quarter of the screen; the address bar collapsing takes far less.
    onChange(isTextEntry(document.activeElement) && height < tallest * 0.75)
  }
  // focusout fires before focus lands on the next field; wait a tick.
  const onFocus = () => setTimeout(update, 0)
  vv.addEventListener('resize', update)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onFocus)
  update()
  return () => {
    vv.removeEventListener('resize', update)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onFocus)
  }
}

export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

// Chrome, Edge and Android fire this once, possibly before React mounts, so it's caught at import time.
let installEvent: BeforeInstallPromptEvent | null = null
const installSubs = new Set<() => void>()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e as BeforeInstallPromptEvent
  installSubs.forEach((f) => f())
})

/** Returns a function that shows the browser's install prompt, or null if unavailable. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    installSubs.add(rerender)
    return () => void installSubs.delete(rerender)
  }, [])
  if (!installEvent) return null
  return async () => {
    await installEvent?.prompt()
    installEvent = null
    installSubs.forEach((f) => f())
  }
}
