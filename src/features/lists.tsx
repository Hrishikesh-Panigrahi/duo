import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Cake, CalendarClock, Check, ChevronLeft, ListChecks, Pencil, Plus, Trash } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { List, ListItem } from '../lib/types'
import { daysBetween, formatDay, nextBirthday, parseYMD, relativeDays, todayYMD, toYMDString } from '../lib/dates'
import { Button, EmptyState, Field, IconButton, Input, Sheet, cx, toast, toastError } from '../components/ui'
import { useNav } from './nav'

const EMOJIS = ['🛒', '✅', '🏠', '🎁', '✈️', '🍿', '💊', '📚', '🎉', '💡', '🧺', '❤️']

// Birthdays this far out appear under "Coming up"; due items a bit sooner.
const BIRTHDAY_WINDOW = 30
const DUE_WINDOW = 14

function CheckCircle({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
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

function dueTone(days: number) {
  return days < 0 ? 'text-danger' : days <= 1 ? 'text-accent' : 'text-muted'
}

export function ListsTab() {
  const { lists, list_items } = useSpace()
  const [openListId, setOpenListId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const openList = lists.find((l) => l.id === openListId)

  if (openList) return <ListView list={openList} onBack={() => setOpenListId(null)} />

  return (
    <div className="h-full overflow-y-auto px-4 pt-4 pb-8">
      <ComingUp onOpenList={setOpenListId} />

      <div className="mt-7 mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Lists</h2>
        <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
          New list
        </Button>
      </div>
      {lists.length === 0 ? (
        <EmptyState icon={<ListChecks />} title="Shared lists">
          Groceries, things to fix, gift ideas, places to go. Tick something off and it's ticked off for both of you.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {lists.map((l) => {
            const items = list_items.filter((i) => i.list_id === l.id)
            const left = items.filter((i) => !i.done).length
            return (
              <button
                key={l.id}
                onClick={() => setOpenListId(l.id)}
                className="rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent/40"
              >
                <div className="text-2xl leading-none">{l.emoji || '📝'}</div>
                <div className="mt-3 truncate font-semibold">{l.title}</div>
                <div className="text-sm text-muted">
                  {items.length === 0 ? 'Empty' : left === 0 ? 'All done' : `${left} to do`}
                </div>
                {items.length > 0 && (
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${((items.length - left) / items.length) * 100}%` }} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      <ListSheet open={creating} list={null} onClose={() => setCreating(false)} onSaved={(l) => setOpenListId(l.id)} />
    </div>
  )
}

type Upcoming =
  | { kind: 'birthday'; days: number; key: string; contactId: string; name: string; date: string; turning: number | null }
  | { kind: 'item'; days: number; key: string; item: ListItem }

function ComingUp({ onOpenList }: { onOpenList: (id: string) => void }) {
  const { contacts, list_items, lists, actions } = useSpace()
  const nav = useNav()
  const today = todayYMD()

  const upcoming = useMemo(() => {
    const out: Upcoming[] = []
    for (const c of contacts) {
      if (!c.birthday) continue
      const next = nextBirthday(c.birthday, today)
      if (next.daysAway <= BIRTHDAY_WINDOW) {
        out.push({ kind: 'birthday', days: next.daysAway, key: c.id, contactId: c.id, name: c.full_name, date: next.date, turning: next.turning })
      }
    }
    for (const i of list_items) {
      if (!i.due_date || i.done) continue
      const days = daysBetween(today, i.due_date)
      if (days <= DUE_WINDOW) out.push({ kind: 'item', days, key: i.id, item: i })
    }
    return out.sort((a, b) => a.days - b.days)
  }, [contacts, list_items, today])

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Coming up</h2>
      {upcoming.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          Nothing in the next few weeks. Birthdays from your contacts and list items with due dates show up here.
        </p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {upcoming.slice(0, 8).map((u) =>
            u.kind === 'birthday' ? (
              <button key={u.key} onClick={() => nav.openContact(u.contactId)} className="flex w-full items-center gap-1 py-1 pr-4 text-left hover:bg-surface-2">
                <span className="flex size-11 shrink-0 items-center justify-center">
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <Cake className="size-4" />
                  </span>
                </span>
                <div className="min-w-0 flex-1 py-2">
                  <div className="truncate font-medium">{u.name}'s birthday</div>
                  <div className="text-sm text-muted">
                    {u.turning !== null ? `Turns ${u.turning} · ` : ''}
                    {formatDay(u.date, false)}
                  </div>
                </div>
                <span className={cx('text-sm font-medium', dueTone(u.days))}>{relativeDays(u.days)}</span>
              </button>
            ) : (
              <div key={u.key} className="flex items-center gap-1 py-1 pr-4">
                <CheckCircle
                  checked={false}
                  label={`Mark "${u.item.text}" done`}
                  onToggle={() => actions.updateItem(u.item.id, { done: true }).catch(toastError)}
                />
                <button className="min-w-0 flex-1 py-2 text-left" onClick={() => onOpenList(u.item.list_id)}>
                  <div className="truncate font-medium">{u.item.text}</div>
                  <div className="truncate text-sm text-muted">
                    {(() => {
                      const l = lists.find((x) => x.id === u.item.list_id)
                      return l ? `${l.emoji ?? '📝'} ${l.title}` : ''
                    })()}
                  </div>
                </button>
                <span className={cx('text-sm font-medium', dueTone(u.days))}>{relativeDays(u.days)}</span>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  )
}

function ListView({ list, onBack }: { list: List; onBack: () => void }) {
  const { list_items, actions } = useSpace()
  const items = list_items.filter((i) => i.list_id === list.id)
  const todo = items.filter((i) => !i.done)
  const done = items.filter((i) => i.done)
  const [draft, setDraft] = useState('')
  const [editingItem, setEditingItem] = useState<ListItem | null>(null)
  const [editingList, setEditingList] = useState(false)
  const [showDone, setShowDone] = useState(true)
  const input = useRef<HTMLInputElement>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try {
      await actions.addItem(list.id, text)
    } catch (err) {
      setDraft(text)
      toastError(err)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-1 py-1.5">
        <IconButton label="Back to lists" onClick={onBack}>
          <ChevronLeft />
        </IconButton>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {list.emoji || '📝'} {list.title}
        </h2>
        <IconButton label="Edit list" onClick={() => setEditingList(true)} className="text-muted">
          <Pencil />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-4">
        {items.length === 0 && <p className="py-12 text-center text-sm text-muted">Nothing here yet. Add the first thing below.</p>}
        {todo.map((i) => (
          <ItemRow key={i.id} item={i} onOpen={() => setEditingItem(i)} />
        ))}
        {done.length > 0 && (
          <>
            <div className="mt-3 flex items-center justify-between px-4 py-1">
              <button className="text-sm font-medium text-muted" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                {showDone ? '▾' : '▸'} Done ({done.length})
              </button>
              <button
                className="text-sm font-medium text-accent"
                onClick={() => actions.clearDone(list.id).then(() => toast('Cleared'), toastError)}
              >
                Clear done
              </button>
            </div>
            {showDone && done.map((i) => <ItemRow key={i.id} item={i} onOpen={() => setEditingItem(i)} />)}
          </>
        )}
      </div>

      <form onSubmit={add} className="flex shrink-0 gap-2 border-t border-line bg-bg p-2">
        <Input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an item" enterKeyHint="send" maxLength={500} />
        <IconButton
          type="submit"
          label="Add item"
          disabled={!draft.trim()}
          onMouseDown={(e) => e.preventDefault()}
          className="size-11 bg-accent text-accent-ink hover:bg-accent"
        >
          <Plus />
        </IconButton>
      </form>

      <Sheet open={!!editingItem} onClose={() => setEditingItem(null)} title="Item">
        {editingItem && <ItemForm item={editingItem} onDone={() => setEditingItem(null)} />}
      </Sheet>
      <ListSheet open={editingList} list={list} onClose={() => setEditingList(false)} onDeleted={onBack} />
    </div>
  )
}

function ItemRow({ item, onOpen }: { item: ListItem; onOpen: () => void }) {
  const { actions } = useSpace()
  const days = item.due_date ? daysBetween(todayYMD(), item.due_date) : null
  return (
    <div className="flex items-start gap-1 pr-4 pl-1">
      <CheckCircle
        checked={item.done}
        label={item.text}
        onToggle={() => actions.updateItem(item.id, { done: !item.done }).catch(toastError)}
      />
      <button onClick={onOpen} className="min-w-0 flex-1 py-2.5 text-left">
        <div className={cx('break-words', item.done && 'text-muted line-through')}>{item.text}</div>
        {item.due_date && days !== null && !item.done && (
          <div className={cx('mt-0.5 flex items-center gap-1 text-xs', dueTone(days))}>
            <CalendarClock className="size-3.5" />
            {relativeDays(days)} · {formatDay(item.due_date)}
          </div>
        )}
      </button>
    </div>
  )
}

function shiftDays(ymd: string, n: number) {
  const { y, m, d } = parseYMD(ymd)
  const date = new Date(y, m - 1, d + n)
  return toYMDString({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })
}

function ItemForm({ item, onDone }: { item: ListItem; onDone: () => void }) {
  const { actions } = useSpace()
  const [text, setText] = useState(item.text)
  const [due, setDue] = useState(item.due_date ?? '')
  const [busy, setBusy] = useState(false)
  const today = todayYMD()
  const saturday = shiftDays(today, (6 - new Date().getDay() + 7) % 7 || 7)
  const presets = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: shiftDays(today, 1) },
    { label: 'Saturday', value: saturday },
    { label: 'Next week', value: shiftDays(today, 7) },
  ]

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      await actions.updateItem(item.id, { text: text.trim(), due_date: due || null })
      onDone()
    } catch (err) {
      toastError(err)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="What">
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} required />
      </Field>
      <div>
        <Field label="Due">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setDue(p.value)}
              className={cx('h-8 rounded-full px-3 text-sm', due === p.value ? 'bg-ink text-bg' : 'bg-surface-2')}
            >
              {p.label}
            </button>
          ))}
          {due && (
            <button type="button" onClick={() => setDue('')} className="h-8 rounded-full px-3 text-sm text-muted">
              No date
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="danger"
          icon={<Trash />}
          onClick={() => actions.deleteItem(item.id).then(onDone, toastError)}
        >
          Delete
        </Button>
        <Button type="submit" loading={busy} className="flex-1">
          Save
        </Button>
      </div>
    </form>
  )
}

function ListSheet({
  open,
  list,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean
  list: List | null
  onClose: () => void
  onSaved?: (l: List) => void
  onDeleted?: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={list ? 'Edit list' : 'New list'}>
      <ListForm
        list={list}
        onSaved={(l) => {
          onClose()
          onSaved?.(l)
        }}
        onDeleted={() => {
          onClose()
          onDeleted?.()
        }}
      />
    </Sheet>
  )
}

function ListForm({ list, onSaved, onDeleted }: { list: List | null; onSaved: (l: List) => void; onDeleted: () => void }) {
  const { actions } = useSpace()
  const [title, setTitle] = useState(list?.title ?? '')
  const [emoji, setEmoji] = useState(list?.emoji ?? EMOJIS[0])
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const input = { title: title.trim(), emoji }
      onSaved(list ? await actions.updateList(list.id, input) : await actions.addList(input))
    } catch (err) {
      toastError(err)
      setBusy(false)
    }
  }

  async function remove() {
    if (!list || !confirm(`Delete "${list.title}" and everything on it, for both of you?`)) return
    try {
      await actions.deleteList(list.id)
      onDeleted()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Icon">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={emoji === e}
            onClick={() => setEmoji(e)}
            className={cx('flex aspect-square items-center justify-center rounded-xl text-2xl transition', emoji === e ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface-2')}
          >
            {e}
          </button>
        ))}
      </div>
      <Field label="Name">
        <Input required autoFocus={!list} maxLength={80} placeholder="e.g. Groceries" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        {list ? 'Save' : 'Create list'}
      </Button>
      {list && (
        <Button variant="danger" size="sm" icon={<Trash />} className="w-full" onClick={remove}>
          Delete list
        </Button>
      )}
    </form>
  )
}
