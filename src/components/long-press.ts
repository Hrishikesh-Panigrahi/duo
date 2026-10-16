// Long-press on touch, right-click on desktop, for opening a menu on something.
import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * The menu opens while the finger is still down, so whatever the browser does
 * with that press next lands on the menu now under it: its own long-press
 * (selecting a word, a callout) or, when the finger lifts, a click on the
 * backdrop that would close the menu straight away. Hold all of that off
 * until just after the finger lifts.
 */
function holdOffNativeLongPress() {
  const types = ['selectstart', 'contextmenu', 'click']
  const block = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const opts = { capture: true }
  for (const type of types) document.addEventListener(type, block, opts)
  let done = false
  const release = () => {
    if (done) return
    done = true
    for (const type of types) document.removeEventListener(type, block, opts)
    window.getSelection()?.removeAllRanges()
  }
  // The click from lifting the finger arrives right after it; a real tap on
  // the menu comes much later than this.
  const later = () => setTimeout(release, 400)
  for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) window.addEventListener(type, later, { once: true, capture: true })
  setTimeout(release, 3000) // in case the finger-up never arrives
}

/** Long-press on touch, right-click on desktop. */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cancel = () => {
    clearTimeout(timer.current)
    origin.current = null
  }
  const fire = (byTouch: boolean) => {
    if (fired.current) return
    fired.current = true
    navigator.vibrate?.(10)
    if (byTouch) holdOffNativeLongPress()
    onLongPress()
  }
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      const byTouch = e.pointerType !== 'mouse'
      timer.current = setTimeout(() => fire(byTouch), ms)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault()
      cancel()
      fire(false)
    },
    // A long-press shouldn't also follow a link inside the bubble.
    onClickCapture: (e: ReactMouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
  }
}
