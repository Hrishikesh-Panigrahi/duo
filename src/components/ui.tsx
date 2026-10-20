import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import { LoaderCircle, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

const variants = {
  primary: 'bg-accent text-accent-ink hover:brightness-105 active:brightness-95',
  secondary: 'bg-surface-2 text-ink hover:bg-line/70',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'text-danger hover:bg-danger/10',
}
const sizes = {
  sm: 'h-9 gap-1.5 rounded-lg px-3 text-sm [&_svg]:size-4',
  md: 'h-11 gap-2 rounded-xl px-4 [&_svg]:size-[18px]',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition select-none disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

/** An on/off switch. `label` names what it turns on, for screen readers. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50', checked ? 'bg-accent' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'left-[1.375rem]' : 'left-0.5')} />
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-surface-2 active:bg-line/70 disabled:opacity-40 [&_svg]:size-5',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

const fieldClass =
  'w-full rounded-xl bg-surface-2 px-3.5 text-base text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/40'

export function Input({ className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(fieldClass, 'h-11', className)} {...rest} />
}

export function Textarea({ className, ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cx(fieldClass, 'py-2.5', className)} {...rest} />
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

/** The first letters of the first two words, or "?" for a blank name. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2)
  let initials = ''
  // [...word] splits by code point, so an emoji's two UTF-16 halves stay together.
  for (const word of words) initials += [...word][0]?.toUpperCase() ?? ''
  return initials || '?'
}

/** The same name always gets the same colour. */
function hueOf(name: string): number {
  let hue = 0
  for (const char of name) hue = (hue * 31 + char.codePointAt(0)!) % 360
  return hue
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('avatar', className)}
      style={{ '--h': hueOf(name), width: size, height: size, fontSize: size * 0.38 } as CSSProperties}
    >
      {initialsOf(name)}
    </span>
  )
}

export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  const chipClass = cx(
    'inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm whitespace-nowrap transition',
    active ? 'bg-ink text-bg' : 'bg-surface-2 text-ink',
    onClick && 'hover:brightness-95',
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={chipClass} aria-pressed={active}>
      {children}
    </button>
  ) : (
    <span className={chipClass}>{children}</span>
  )
}

type MenuItemProps = { icon: ReactNode; children: ReactNode; danger?: boolean; onClick: () => void }

/** A row in an action menu (inside a Sheet). */
export function MenuItem({ icon, children, danger, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium transition select-none hover:bg-surface-2 [&_svg]:size-5',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent [&_svg]:size-7">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="mt-1.5 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin text-muted', className)} />
}

export function Splash() {
  return (
    <div className="app-height flex items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}

type SheetProps = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Extra header buttons, left of the close button. */
  actions?: ReactNode
}

/** A bottom sheet on phones, a dialog on wider screens. Children mount only while open, so each opening starts fresh. */
export function Sheet({ open, onClose, title, children, actions }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])
  // A click whose target is the dialog itself landed on the backdrop, outside the panel.
  const closeOnBackdropClick = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }
  return (
    <dialog ref={dialogRef} className="sheet" onClose={onClose} onClick={closeOnBackdropClick}>
      {open && (
        <div className="sheet-panel">
          <header className="flex shrink-0 items-center gap-1 py-2 pr-2 pl-5">
            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold select-none">{title}</h2>
            {actions}
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}

// ─── Toasts ────────────────────────────────────────────────────────────

type ToastMsg = { id: number; text: string; tone: 'info' | 'error' }
const toastListeners = new Set<(message: ToastMsg) => void>()
let lastToastId = 0
const MAX_TOASTS = 3
const ERROR_TOAST_MS = 5000
const INFO_TOAST_MS = 2600

export function toast(text: string, tone: ToastMsg['tone'] = 'info') {
  const message = { id: ++lastToastId, text, tone }
  for (const listener of toastListeners) listener(message)
}

/** How browsers word "couldn't reach the server": each throws a TypeError with its own message. */
const OFFLINE_ERROR = /failed to fetch|load failed|networkerror|network request failed/i

export function errorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (OFFLINE_ERROR.test(message)) return "Can't reach the server. Check your connection and try again."
  return message
}

export const toastError = (e: unknown) => toast(errorMessage(e), 'error')

function useToasts(): ToastMsg[] {
  const [items, setItems] = useState<ToastMsg[]>([])
  useEffect(() => {
    const show = (message: ToastMsg) => {
      setItems((shown) => [...shown, message].slice(-MAX_TOASTS))
      const showForMs = message.tone === 'error' ? ERROR_TOAST_MS : INFO_TOAST_MS
      setTimeout(() => setItems((shown) => shown.filter((x) => x.id !== message.id)), showForMs)
    }
    toastListeners.add(show)
    return () => {
      toastListeners.delete(show)
    }
  }, [])
  return items
}

/** In the browser's top layer (a popover), re-shown on every change so it sits above the newest sheet. */
export function Toaster() {
  const items = useToasts()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.showPopover !== 'function') return
    if (el.matches(':popover-open')) el.hidePopover()
    if (items.length) el.showPopover()
  }, [items])
  return (
    <div ref={ref} popover="manual" className="toaster" role="status" aria-live="polite">
      {items.map((message) => (
        <div
          key={message.id}
          className={cx('rounded-full px-4 py-2.5 text-sm font-medium shadow-lg', message.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-bg')}
        >
          {message.text}
        </div>
      ))}
    </div>
  )
}
