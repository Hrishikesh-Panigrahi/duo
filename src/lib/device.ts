import { useEffect, useReducer, useState } from 'react'

/** Keeps --app-h equal to the visible height: on iOS the keyboard shrinks only the visual viewport. */
export function trackViewportHeight() {
  const viewport = window.visualViewport
  if (!viewport) return
  const update = () => {
    document.documentElement.style.setProperty('--app-h', `${Math.round(viewport.height * viewport.scale)}px`)
    if (viewport.offsetTop > 0 && viewport.scale === 1) window.scrollTo(0, 0)
  }
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
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
    const viewport = window.visualViewport
    return viewport ? watchKeyboard(viewport, setOpen) : undefined
  }, [])
  return open
}

/** Returns a function that stops watching. */
function watchKeyboard(viewport: VisualViewport, onChange: (open: boolean) => void): () => void {
  // The tallest the visible area has been at this width: rotating changes the width, a keyboard doesn't.
  let width = window.innerWidth
  let tallest = 0
  const update = () => {
    if (window.innerWidth !== width) {
      width = window.innerWidth
      tallest = 0
    }
    const height = viewport.height * viewport.scale // ignore pinch-zoom
    tallest = Math.max(tallest, height)
    // Keyboards take well over a quarter of the screen; the address bar collapsing takes far less.
    onChange(isTextEntry(document.activeElement) && height < tallest * 0.75)
  }
  // focusout fires before focus lands on the next field; wait a tick.
  const onFocusMoved = () => setTimeout(update, 0)
  viewport.addEventListener('resize', update)
  document.addEventListener('focusin', onFocusMoved)
  document.addEventListener('focusout', onFocusMoved)
  update()
  return () => {
    viewport.removeEventListener('resize', update)
    document.removeEventListener('focusin', onFocusMoved)
    document.removeEventListener('focusout', onFocusMoved)
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
