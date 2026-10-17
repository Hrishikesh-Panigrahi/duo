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
  const openList = lists.find((list) => list.id === openListId)
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
      <ListSheet open={creating} list={null} onClose={() => setCreating(false)} onSaved={(savedList) => setOpenListId(savedList.id)} />
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
      {lists.map((list) => (
        <ListCard key={list.id} list={list} onOpen={() => onOpen(list.id)} />
      ))}
    </div>
  )
}

function progressLabel(total: number, remaining: number) {
  if (total === 0) return 'Empty'
  if (remaining === 0) return 'All done'
  return `${remaining} to do`
}

function ListCard({ list, onOpen }: { list: List; onOpen: () => void }) {
  const { list_items } = useSpace()
  const items = list_items.filter((item) => item.list_id === list.id)
  const remaining = items.filter((item) => !item.done).length
  const percentDone = ((items.length - remaining) / items.length) * 100
  return (
    <button onClick={onOpen} className="rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent/40">
      <div className="text-2xl leading-none">{list.emoji || '📝'}</div>
      <div className="mt-3 truncate font-semibold">{list.title}</div>
      <div className="text-sm text-muted">{progressLabel(items.length, remaining)}</div>
      {items.length > 0 && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percentDone}%` }} />
        </div>
      )}
    </button>
  )
}
