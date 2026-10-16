import { useMemo } from 'react'
import { Cake } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact, ListItem } from '../lib/types'
import { daysBetween, formatDay, nextBirthday, relativeDays, todayYMD } from '../lib/dates'
import { cx, toastError } from '../components/ui'
import { useNav } from './nav'
import { CheckCircle, dueTone } from './list-parts'

// Birthdays this far out appear under "Coming up"; due items a bit sooner.
const BIRTHDAY_WINDOW = 30
const DUE_WINDOW = 14

type Birthday = { kind: 'birthday'; days: number; key: string; contactId: string; name: string; date: string; turning: number | null }
type DueItem = { kind: 'item'; days: number; key: string; item: ListItem }

/** Soonest first. */
function upcoming(contacts: Contact[], items: ListItem[], today: string): (Birthday | DueItem)[] {
  const out: (Birthday | DueItem)[] = []
  for (const c of contacts) {
    if (!c.birthday) continue
    const next = nextBirthday(c.birthday, today)
    if (next.daysAway > BIRTHDAY_WINDOW) continue
    out.push({ kind: 'birthday', days: next.daysAway, key: c.id, contactId: c.id, name: c.full_name, date: next.date, turning: next.turning })
  }
  for (const i of items) {
    if (!i.due_date || i.done) continue
    const days = daysBetween(today, i.due_date)
    if (days <= DUE_WINDOW) out.push({ kind: 'item', days, key: i.id, item: i })
  }
  return out.sort((a, b) => a.days - b.days)
}

export function ComingUp({ onOpenList }: { onOpenList: (id: string) => void }) {
  const { contacts, list_items } = useSpace()
  const today = todayYMD()
  const soon = useMemo(() => upcoming(contacts, list_items, today), [contacts, list_items, today])
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Coming up</h2>
      {soon.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          Nothing in the next few weeks. Birthdays from your contacts and list items with due dates show up here.
        </p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {soon.slice(0, 8).map((u) =>
            u.kind === 'birthday' ? <BirthdaySoon key={u.key} birthday={u} /> : <DueSoon key={u.key} due={u} onOpenList={onOpenList} />,
          )}
        </div>
      )}
    </section>
  )
}

function BirthdaySoon({ birthday: b }: { birthday: Birthday }) {
  const nav = useNav()
  return (
    <button onClick={() => nav.openContact(b.contactId)} className="flex w-full items-center gap-1 py-1 pr-4 text-left hover:bg-surface-2">
      <span className="flex size-11 shrink-0 items-center justify-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Cake className="size-4" />
        </span>
      </span>
      <div className="min-w-0 flex-1 py-2">
        <div className="truncate font-medium">{b.name}'s birthday</div>
        <div className="text-sm text-muted">
          {b.turning !== null ? `Turns ${b.turning} · ` : ''}
          {formatDay(b.date, false)}
        </div>
      </div>
      <span className={cx('text-sm font-medium', dueTone(b.days))}>{relativeDays(b.days)}</span>
    </button>
  )
}

function DueSoon({ due: { item, days }, onOpenList }: { due: DueItem; onOpenList: (id: string) => void }) {
  const { lists, actions } = useSpace()
  const list = lists.find((l) => l.id === item.list_id)
  return (
    <div className="flex items-center gap-1 py-1 pr-4">
      <CheckCircle checked={false} label={`Mark "${item.text}" done`} onToggle={() => actions.lists.updateItem(item.id, { done: true }).catch(toastError)} />
      <button className="min-w-0 flex-1 py-2 text-left" onClick={() => onOpenList(item.list_id)}>
        <div className="truncate font-medium">{item.text}</div>
        <div className="truncate text-sm text-muted">{list ? `${list.emoji ?? '📝'} ${list.title}` : ''}</div>
      </button>
      <span className={cx('text-sm font-medium', dueTone(days))}>{relativeDays(days)}</span>
    </div>
  )
}
