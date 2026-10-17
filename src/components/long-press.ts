// Long-press on touch, right-click on desktop, for opening a menu on something.
import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

/** Moving further than this while held down cancels the press: it's a scroll, not a hold. */
const MOVE_TOLERANCE_PX = 10

/**
 * The menu opens under a finger that's still down, so the browser's own long-press (selecting a word)
 * and the click from lifting the finger would land on the menu. Holds both off until just after.
 */
function holdOffNativeLongPress() {
  const types = ['selectstart', 'contextmenu', 'click']
  const block = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const captureOption = { capture: true }
  for (const type of types) document.addEventListener(type, block, captureOption)
  let done = false
  const release = () => {
    if (done) return
    done = true
    for (const type of types) document.removeEventListener(type, block, captureOption)
    window.getSelection()?.removeAllRanges()
  }
  // The click from lifting the finger arrives right after it; a real tap on the menu comes much later.
  const releaseSoon = () => setTimeout(release, 400)
  for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) window.addEventListener(type, releaseSoon, { once: true, capture: true })
  setTimeout(release, 3000) // in case the finger-up never arrives
}

class LongPress {
  onLongPress = () => {}
  private timer: ReturnType<typeof setTimeout> | undefined
  private origin: { x: number; y: number } | null = null
  private fired = false

  constructor(private readonly holdMs: number) {}

  readonly handlers = {
    onPointerDown: (e: ReactPointerEvent) => this.press(e),
    onPointerMove: (e: ReactPointerEvent) => this.move(e),
    onPointerUp: () => this.cancel(),
    onPointerLeave: () => this.cancel(),
    onPointerCancel: () => this.cancel(),
    onContextMenu: (e: ReactMouseEvent) => this.rightClick(e),
    // A long-press shouldn't also follow a link inside the bubble.
    onClickCapture: (e: ReactMouseEvent) => this.swallowClickAfterPress(e),
  }

  private press(e: ReactPointerEvent) {
    if (e.button !== 0) return
    this.fired = false
    this.origin = { x: e.clientX, y: e.clientY }
    const byTouch = e.pointerType !== 'mouse'
    this.timer = setTimeout(() => this.fire(byTouch), this.holdMs)
  }

  private move(e: ReactPointerEvent) {
    if (this.origin && Math.hypot(e.clientX - this.origin.x, e.clientY - this.origin.y) > MOVE_TOLERANCE_PX) this.cancel()
  }

  private rightClick(e: ReactMouseEvent) {
    e.preventDefault()
    this.cancel()
    this.fire(false)
  }

  private swallowClickAfterPress(e: ReactMouseEvent) {
    if (!this.fired) return
    e.preventDefault()
    e.stopPropagation()
    this.fired = false
  }

  private cancel() {
    clearTimeout(this.timer)
    this.origin = null
  }

  private fire(byTouch: boolean) {
    if (this.fired) return
    this.fired = true
    navigator.vibrate?.(10)
    if (byTouch) holdOffNativeLongPress()
    this.onLongPress()
  }
}

export function useLongPress(onLongPress: () => void, holdMs = 450) {
  const press = useRef<LongPress | null>(null)
  press.current ??= new LongPress(holdMs)
  press.current.onLongPress = onLongPress
  return press.current.handlers
}
