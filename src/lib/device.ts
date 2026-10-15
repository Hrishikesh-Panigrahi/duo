import { useEffect, useReducer, useState } from 'react'

/**
 * Keeps --app-h equal to the visible height. On iOS the keyboard shrinks the
 * visual viewport but not the layout, so without this the chat composer hides
 * behind the keyboard.
 */
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

/**
 * True while an on-screen keyboard is actually covering the bottom of the
 * screen. Focus alone isn't enough: desktops, tablets with a hardware keyboard
 * and emulators focus fields without any keyboard appearing.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    // Tallest the visible area has been at this width. Rotating changes the
    // width; the keyboard and the browser's address bar don't.
    let width = window.innerWidth
    let tallest = 0
    const update = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth
        tallest = 0
      }
      const height = vv.height * vv.scale // ignore pinch-zoom
      tallest = Math.max(tallest, height)
      // Keyboards take well over a quarter of the screen; the address bar
      // collapsing or expanding takes far less.
      setOpen(isTextEntry(document.activeElement) && height < tallest * 0.75)
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
  }, [])
  return open
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

// Chrome/Edge/Android fire this when the app is installable. It has to be
// caught early, before React mounts, so it's registered at import time.
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
