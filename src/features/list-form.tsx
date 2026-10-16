import { useState, type FormEvent } from 'react'
import { Trash } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { List } from '../lib/types'
import { Button, Field, Input, Sheet, cx, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'

const EMOJIS = ['🛒', '✅', '🏠', '🎁', '✈️', '🍿', '💊', '📚', '🎉', '💡', '🧺', '❤️']

type ListSheetProps = { open: boolean; list: List | null; onClose: () => void; onSaved?: (savedList: List) => void; onDeleted?: () => void }

export function ListSheet({ open, list, onClose, onSaved, onDeleted }: ListSheetProps) {
  const closeAndReportSaved = (savedList: List) => {
    onClose()
    onSaved?.(savedList)
  }
  const closeAndReportDeleted = () => {
    onClose()
    onDeleted?.()
  }
  return (
    <Sheet open={open} onClose={onClose} title={list ? 'Edit list' : 'New list'}>
      <ListForm list={list} onSaved={closeAndReportSaved} onDeleted={closeAndReportDeleted} />
    </Sheet>
  )
}

function ListForm({ list, onSaved, onDeleted }: { list: List | null; onSaved: (savedList: List) => void; onDeleted: () => void }) {
  const { actions } = useSpace()
  const [title, setTitle] = useState(list?.title ?? '')
  const [emoji, setEmoji] = useState(list?.emoji ?? EMOJIS[0])
  const { busy, run } = useBusy({ toast: true })
  function save(e: FormEvent) {
    e.preventDefault()
    const input = { title: title.trim(), emoji }
    void run(async () => {
      const savedList = list ? await actions.lists.update(list.id, input) : await actions.lists.add(input)
      onSaved(savedList)
    })
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <Field label="Name">
        <Input required autoFocus={!list} maxLength={80} placeholder="e.g. Groceries" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        {list ? 'Save' : 'Create list'}
      </Button>
      {list && <DeleteListButton list={list} onDeleted={onDeleted} />}
    </form>
  )
}

function EmojiPicker({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Icon">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="radio"
          aria-checked={value === emoji}
          onClick={() => onChange(emoji)}
          className={cx('flex aspect-square items-center justify-center rounded-xl text-2xl transition', value === emoji ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface-2')}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

function DeleteListButton({ list, onDeleted }: { list: List; onDeleted: () => void }) {
  const { actions } = useSpace()
  async function remove() {
    if (!confirm(`Delete "${list.title}" and everything on it, for both of you?`)) return
    try {
      await actions.lists.remove(list.id)
      onDeleted()
    } catch (err) {
      toastError(err)
    }
  }
  return (
    <Button variant="danger" size="sm" icon={<Trash />} className="w-full" onClick={remove}>
      Delete list
    </Button>
  )
}
