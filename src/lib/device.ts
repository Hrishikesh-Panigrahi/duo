import { useEffect, useReducer, useState } from 'react'

/** Set on <html> while an on-screen keyboard is up; CSS hides the tab bar then (see index.css). */
const KEYBOARD_OPEN_ATTRIBUTE = 'data-keyboard-open'

/**
 * Keeps --app-h equal to the visible height (on iOS the keyboard shrinks only the visual viewport) and marks
 * <html> while a keyboard is up. Both change in the same frame, so the screen moves once, not twice.
 */
export function trackViewport() {
  const viewport = window.visualViewport
  if (!viewport) return
  const keyboard = keyboardDetector(viewport)
  const update = () => {
    const root = document.documentElement
    root.style.setProperty('--app-h', `${Math.round(viewport.height * viewport.scale)}px`)
    root.toggleAttribute(KEYBOARD_OPEN_ATTRIBUTE, keyboard.isOpen())
    if (viewport.offsetTop > 0 && viewport.scale === 1) window.scrollTo(0, 0)
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  // Focus can move to a text field while the keyboard is already up, with no resize.
  document.addEventListener('focusin', () => setTimeout(update, 0))
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

/** Tells when an on-screen keyboard covers the screen. Focus alone isn't enough: desktops focus fields too. */
function keyboardDetector(viewport: VisualViewport) {
  // The tallest the visible area has been at this width: rotating changes the width, a keyboard doesn't.
  let width = window.innerWidth
  let tallest = 0
  let open = false
  return {
    isOpen() {
      if (window.innerWidth !== width) {
        width = window.innerWidth
        tallest = 0
      }
      const height = viewport.height * viewport.scale // ignore pinch-zoom
      tallest = Math.max(tallest, height)
      // Keyboards take well over a quarter of the screen; the address bar collapsing takes far less.
      const shrunk = height < tallest * 0.75
      // It opens only for a text field, and counts as closed only once the screen has grown back, not the
      // moment focus leaves: otherwise the tab bar reappears above a keyboard that's still sliding away.
      open = shrunk && (open || isTextEntry(document.activeElement))
      return open
    },
  }
}

export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const updateVisible = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', updateVisible)
    return () => document.removeEventListener('visibilitychange', updateVisible)
  }, [])
  return visible
}

// Chrome, Edge and Android fire this once, possibly before React mounts, so it's caught at import time.
let installEvent: BeforeInstallPromptEvent | null = null
const installPromptListeners = new Set<() => void>()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e as BeforeInstallPromptEvent
  for (const listener of installPromptListeners) listener()
})

/** Returns a function that shows the browser's install prompt, or null if unavailable. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    installPromptListeners.add(rerender)
    return () => {
      installPromptListeners.delete(rerender)
    }
  }, [])
  if (!installEvent) return null
  return async () => {
    await installEvent?.prompt()
    installEvent = null
    for (const listener of installPromptListeners) listener()
  }
}
