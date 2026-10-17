import { useMemo } from 'react'
import { Cake } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact, ListItem } from '../lib/types'
import { daysBetween, formatDay, nextBirthday, relativeDays, toLocalYMD } from '../lib/dates'
import { cx, toastError } from '../components/ui'
import { useNav } from './nav'
import { CheckCircle, daysAwayColor } from './list-parts'

// Birthdays this far out appear under "Coming up"; due items a bit sooner.
const BIRTHDAY_WINDOW_DAYS = 30
const DUE_WINDOW_DAYS = 14
const MAX_SHOWN = 8

type UpcomingBirthday = { kind: 'birthday'; days: number; key: string; contactId: string; name: string; date: string; turning: number | null }
type UpcomingDueItem = { kind: 'item'; days: number; key: string; item: ListItem }

/** Soonest first. */
function collectUpcoming(contacts: Contact[], items: ListItem[], today: string): (UpcomingBirthday | UpcomingDueItem)[] {
  const upcoming: (UpcomingBirthday | UpcomingDueItem)[] = []
  for (const contact of contacts) {
    if (!contact.birthday) continue
    const next = nextBirthday(contact.birthday, today)
    if (next.daysAway > BIRTHDAY_WINDOW_DAYS) continue
    upcoming.push({ kind: 'birthday', days: next.daysAway, key: contact.id, contactId: contact.id, name: contact.full_name, date: next.date, turning: next.turning })
  }
  for (const item of items) {
    if (!item.due_date || item.done) continue
    const days = daysBetween(today, item.due_date)
    if (days <= DUE_WINDOW_DAYS) upcoming.push({ kind: 'item', days, key: item.id, item })
  }
  return upcoming.sort((a, b) => a.days - b.days)
}

export function ComingUp({ onOpenList }: { onOpenList: (id: string) => void }) {
  const { contacts, list_items } = useSpace()
  const today = toLocalYMD()
  const upcoming = useMemo(() => collectUpcoming(contacts, list_items, today), [contacts, list_items, today])
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Coming up</h2>
      {upcoming.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          Nothing in the next few weeks. Birthdays from your contacts and list items with due dates show up here.
        </p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {upcoming.slice(0, MAX_SHOWN).map((entry) =>
            entry.kind === 'birthday' ? (
              <BirthdayRow key={entry.key} birthday={entry} />
            ) : (
              <DueItemRow key={entry.key} due={entry} onOpenList={onOpenList} />
            ),
          )}
        </div>
      )}
    </section>
  )
}

function BirthdayRow({ birthday }: { birthday: UpcomingBirthday }) {
  const nav = useNav()
  return (
    <button onClick={() => nav.openContact(birthday.contactId)} className="flex w-full items-center gap-1 py-1 pr-4 text-left hover:bg-surface-2">
      <span className="flex size-11 shrink-0 items-center justify-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Cake className="size-4" />
        </span>
      </span>
      <div className="min-w-0 flex-1 py-2">
        <div className="truncate font-medium">{birthday.name}'s birthday</div>
        <div className="text-sm text-muted">
          {birthday.turning !== null ? `Turns ${birthday.turning} · ` : ''}
          {formatDay(birthday.date, false)}
        </div>
      </div>
      <span className={cx('text-sm font-medium', daysAwayColor(birthday.days))}>{relativeDays(birthday.days)}</span>
    </button>
  )
}

function DueItemRow({ due: { item, days }, onOpenList }: { due: UpcomingDueItem; onOpenList: (id: string) => void }) {
  const { lists, actions } = useSpace()
  const list = lists.find((l) => l.id === item.list_id)
  return (
    <div className="flex items-center gap-1 py-1 pr-4">
      <CheckCircle checked={false} label={`Mark "${item.text}" done`} onToggle={() => actions.lists.updateItem(item.id, { done: true }).catch(toastError)} />
      <button className="min-w-0 flex-1 py-2 text-left" onClick={() => onOpenList(item.list_id)}>
        <div className="truncate font-medium">{item.text}</div>
        <div className="truncate text-sm text-muted">{list ? `${list.emoji ?? '📝'} ${list.title}` : ''}</div>
      </button>
      <span className={cx('text-sm font-medium', daysAwayColor(days))}>{relativeDays(days)}</span>
    </div>
  )
}
