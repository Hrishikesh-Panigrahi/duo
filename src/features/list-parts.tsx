import { Check } from 'lucide-react'
import { cx } from '../components/ui'

/** Overdue in red, today or tomorrow in the accent colour, anything later muted. */
export function dueTone(days: number) {
  return days < 0 ? 'text-danger' : days <= 1 ? 'text-accent' : 'text-muted'
}

export function CheckCircle({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="group flex size-11 shrink-0 items-center justify-center"
    >
      <span
        className={cx(
          'flex size-6 items-center justify-center rounded-full border-2 transition',
          checked ? 'border-accent bg-accent text-accent-ink' : 'border-line group-hover:border-accent',
        )}
      >
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
    </button>
  )
}
