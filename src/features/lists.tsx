import { useState } from 'react'
import { ListChecks, Plus } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { List } from '../lib/types'
import { Button, EmptyState } from '../components/ui'
import { ComingUp } from './coming-up'
import { ListView } from './list-view'
import { ListSheet } from './list-form'

export function ListsTab() {
  const { lists } = useSpace()
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
      <ListGrid lists={lists} onOpen={setOpenListId} />
      <ListSheet open={creating} list={null} onClose={() => setCreating(false)} onSaved={(l) => setOpenListId(l.id)} />
    </div>
  )
}

function ListGrid({ lists, onOpen }: { lists: List[]; onOpen: (id: string) => void }) {
  if (!lists.length) {
    return (
      <EmptyState icon={<ListChecks />} title="Shared lists">
        Groceries, things to fix, gift ideas, places to go. Tick something off and it's ticked off for both of you.
      </EmptyState>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {lists.map((l) => (
        <ListCard key={l.id} list={l} onOpen={() => onOpen(l.id)} />
      ))}
    </div>
  )
}

function ListCard({ list, onOpen }: { list: List; onOpen: () => void }) {
  const { list_items } = useSpace()
  const items = list_items.filter((i) => i.list_id === list.id)
  const left = items.filter((i) => !i.done).length
  return (
    <button onClick={onOpen} className="rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent/40">
      <div className="text-2xl leading-none">{list.emoji || '📝'}</div>
      <div className="mt-3 truncate font-semibold">{list.title}</div>
      <div className="text-sm text-muted">{items.length === 0 ? 'Empty' : left === 0 ? 'All done' : `${left} to do`}</div>
      {items.length > 0 && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${((items.length - left) / items.length) * 100}%` }} />
        </div>
      )}
    </button>
  )
}
