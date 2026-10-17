import { useState, type FormEvent } from 'react'
import { CalendarClock, ChevronLeft, Pencil, Plus, Trash } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { List, ListItem } from '../lib/types'
import { daysBetween, formatDay, parseYMD, relativeDays, toLocalYMD, toYMDString } from '../lib/dates'
import { Button, Field, IconButton, Input, Sheet, cx, toast, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'
import { CheckCircle, daysAwayColor } from './list-parts'
import { ListSheet } from './list-form'

// Date.getDay() numbering: Sunday is 0.
const SATURDAY = 6

function addDays(ymd: string, days: number) {
  const { y, m, d } = parseYMD(ymd)
  const date = new Date(y, m - 1, d + days)
  return toYMDString({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })
}

/** The quick picks under the due date, counted from `today`. */
function duePresets(today: string) {
  const { y, m, d } = parseYMD(today)
  const weekday = new Date(y, m - 1, d).getDay()
  // On a Saturday, the next one.
  const daysToSaturday = weekday === SATURDAY ? 7 : SATURDAY - weekday
  return [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'Saturday', value: addDays(today, daysToSaturday) },
    { label: 'Next week', value: addDays(today, 7) },
  ]
}

export function ListView({ list, onBack }: { list: List; onBack: () => void }) {
  const { list_items } = useSpace()
  const items = list_items.filter((item) => item.list_id === list.id)
  const toDoItems = items.filter((item) => !item.done)
  const doneItems = items.filter((item) => item.done)
  const [editingItem, setEditingItem] = useState<ListItem | null>(null)
  const [editingList, setEditingList] = useState(false)
  return (
    <div className="flex h-full flex-col">
      <ListHeader list={list} onBack={onBack} onEdit={() => setEditingList(true)} />
      <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-4">
        {items.length === 0 && <p className="py-12 text-center text-sm text-muted">Nothing here yet. Add the first thing below.</p>}
        {toDoItems.map((item) => (
          <ItemRow key={item.id} item={item} onOpen={() => setEditingItem(item)} />
        ))}
        <DoneItems listId={list.id} items={doneItems} onOpen={setEditingItem} />
      </div>
      <AddItemForm listId={list.id} />
      <Sheet open={!!editingItem} onClose={() => setEditingItem(null)} title="Item">
        {editingItem && <ItemForm item={editingItem} onDone={() => setEditingItem(null)} />}
      </Sheet>
      <ListSheet open={editingList} list={list} onClose={() => setEditingList(false)} onDeleted={onBack} />
    </div>
  )
}

function ListHeader({ list, onBack, onEdit }: { list: List; onBack: () => void; onEdit: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-1 py-1.5">
      <IconButton label="Back to lists" onClick={onBack}>
        <ChevronLeft />
      </IconButton>
      <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
        {list.emoji || '📝'} {list.title}
      </h2>
      <IconButton label="Edit list" onClick={onEdit} className="text-muted">
        <Pencil />
      </IconButton>
    </div>
  )
}

function DoneItems({ listId, items, onOpen }: { listId: string; items: ListItem[]; onOpen: (item: ListItem) => void }) {
  const { actions } = useSpace()
  const [shown, setShown] = useState(true)
  if (!items.length) return null
  return (
    <>
      <div className="mt-3 flex items-center justify-between px-4 py-1">
        <button className="text-sm font-medium text-muted" onClick={() => setShown((s) => !s)} aria-expanded={shown}>
          {shown ? '▾' : '▸'} Done ({items.length})
        </button>
        <button className="text-sm font-medium text-accent" onClick={() => actions.lists.clearDone(listId).then(() => toast('Cleared'), toastError)}>
          Clear done
        </button>
      </div>
      {shown && items.map((item) => <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />)}
    </>
  )
}

function ItemRow({ item, onOpen }: { item: ListItem; onOpen: () => void }) {
  const { actions } = useSpace()
  return (
    <div className="flex items-start gap-1 pr-4 pl-1">
      <CheckCircle checked={item.done} label={item.text} onToggle={() => actions.lists.updateItem(item.id, { done: !item.done }).catch(toastError)} />
      <button onClick={onOpen} className="min-w-0 flex-1 py-2.5 text-left">
        <div className={cx('break-words', item.done && 'text-muted line-through')}>{item.text}</div>
        {item.due_date && !item.done && <DueLabel dueDate={item.due_date} />}
      </button>
    </div>
  )
}

function DueLabel({ dueDate }: { dueDate: string }) {
  const daysUntilDue = daysBetween(toLocalYMD(), dueDate)
  return (
    <div className={cx('mt-0.5 flex items-center gap-1 text-xs', daysAwayColor(daysUntilDue))}>
      <CalendarClock className="size-3.5" />
      {relativeDays(daysUntilDue)} · {formatDay(dueDate)}
    </div>
  )
}

function AddItemForm({ listId }: { listId: string }) {
  const { actions } = useSpace()
  const [draft, setDraft] = useState('')
  async function add(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await actions.lists.addItem(listId, text).catch((err) => {
      setDraft(text)
      toastError(err)
    })
  }
  return (
    <form onSubmit={add} className="flex shrink-0 gap-2 border-t border-line bg-bg p-2">
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an item" enterKeyHint="send" maxLength={500} />
      <IconButton
        type="submit"
        label="Add item"
        disabled={!draft.trim()}
        // Keep the keyboard up: don't let the button steal focus from the input.
        onMouseDown={(e) => e.preventDefault()}
        className="size-11 bg-accent text-accent-ink hover:bg-accent"
      >
        <Plus />
      </IconButton>
    </form>
  )
}

function ItemForm({ item, onDone }: { item: ListItem; onDone: () => void }) {
  const { actions } = useSpace()
  const [text, setText] = useState(item.text)
  const [dueDate, setDueDate] = useState(item.due_date ?? '')
  const { busy, run } = useBusy({ toast: true })
  function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    void run(async () => {
      await actions.lists.updateItem(item.id, { text: trimmed, due_date: dueDate || null })
      onDone()
    })
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="What">
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} required />
      </Field>
      <DueInput value={dueDate} onChange={setDueDate} />
      <div className="flex gap-2">
        <DeleteItemButton item={item} onDeleted={onDone} />
        <Button type="submit" loading={busy} className="flex-1">
          Save
        </Button>
      </div>
    </form>
  )
}

function DeleteItemButton({ item, onDeleted }: { item: ListItem; onDeleted: () => void }) {
  const { actions } = useSpace()
  return (
    <Button variant="danger" icon={<Trash />} onClick={() => actions.lists.removeItem(item.id).then(onDeleted, toastError)}>
      Delete
    </Button>
  )
}

function DueInput({ value, onChange }: { value: string; onChange: (dueDate: string) => void }) {
  const presets = duePresets(toLocalYMD())
  return (
    <div>
      <Field label="Due">
        <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button key={preset.label} type="button" onClick={() => onChange(preset.value)} className={cx('h-8 rounded-full px-3 text-sm', value === preset.value ? 'bg-ink text-bg' : 'bg-surface-2')}>
            {preset.label}
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange('')} className="h-8 rounded-full px-3 text-sm text-muted">
            No date
          </button>
        )}
      </div>
    </div>
  )
}
