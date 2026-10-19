import { createContext, useContext, useEffect, useState } from 'react'
import { Check, Lock, Plus } from 'lucide-react'
import { loadSpaceSummaries, type SpaceSummary } from '../lib/spaces'
import { Avatar, Button, Sheet, cx, toastError } from '../components/ui'

/** The spaces you're in, the one that's open, and how to change it. Provided above the open space (App.tsx). */
export type SpaceSwitch = {
  userId: string
  spaceIds: string[]
  currentId: string
  open: (spaceId: string) => void
  /** Shows the screen for starting or joining another space. */
  addSpace: () => void
}

export const SpaceSwitchContext = createContext<SpaceSwitch | null>(null)

export function useSpaceSwitch(): SpaceSwitch {
  const spaceSwitch = useContext(SpaceSwitchContext)
  if (!spaceSwitch) throw new Error('useSpaceSwitch must be used inside <SpaceSwitchContext>')
  return spaceSwitch
}

export function SpaceSwitcherSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const spaceSwitch = useSpaceSwitch()
  const startOrJoin = () => {
    onClose()
    spaceSwitch.addSpace()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Your spaces">
      <div className="space-y-3 overflow-y-auto p-4">
        <SpaceList onOpened={onClose} />
        <Button variant="secondary" icon={<Plus />} className="w-full" onClick={startOrJoin}>
          Start or join another space
        </Button>
      </div>
    </Sheet>
  )
}

/** Mounts each time the sheet opens, so names and unread counts are fresh. */
function SpaceList({ onOpened }: { onOpened: () => void }) {
  const { userId, spaceIds, currentId, open } = useSpaceSwitch()
  const [summaries, setSummaries] = useState<SpaceSummary[] | null>(null)
  useEffect(() => {
    loadSpaceSummaries(spaceIds, userId).then(setSummaries, toastError)
  }, [spaceIds, userId])
  if (!summaries) return <p className="py-6 text-center text-sm text-muted">Loading your spaces…</p>
  const openSpace = (spaceId: string) => {
    if (spaceId !== currentId) open(spaceId)
    onOpened()
  }
  return (
    <ul className="space-y-1">
      {summaries.map((summary) => (
        <li key={summary.id}>
          <SpaceRow summary={summary} current={summary.id === currentId} onOpen={() => openSpace(summary.id)} />
        </li>
      ))}
    </ul>
  )
}

function SpaceRow({ summary, current, onOpen }: { summary: SpaceSummary; current: boolean; onOpen: () => void }) {
  const title = summary.name ?? (summary.locked ? 'Locked space' : 'New space')
  return (
    <button onClick={onOpen} className={cx('flex w-full items-center gap-3 rounded-xl p-2 text-left', current ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
      <Avatar name={summary.partnerName ?? title} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate font-medium">
          {summary.locked && <Lock className="size-3.5 shrink-0 text-muted" />}
          {title}
        </span>
        <span className="block truncate text-xs text-muted">{partnerLine(summary)}</span>
      </span>
      {summary.unread > 0 && (
        <span className="min-w-[20px] rounded-full bg-accent px-1.5 text-center text-xs leading-5 font-semibold text-accent-ink">
          {summary.unread > 99 ? '99+' : summary.unread}
        </span>
      )}
      {current && <Check className="size-5 shrink-0 text-accent" aria-label="Open now" />}
    </button>
  )
}

function partnerLine(summary: SpaceSummary): string {
  if (!summary.hasPartner) return 'Waiting for your person to join'
  if (summary.partnerName) return `with ${summary.partnerName}`
  return summary.locked ? 'Unlock it to see names' : 'with your person'
}

/** For the setup and unlock screens, which have no header: a way back to your other spaces. */
export function SwitchSpaceLink() {
  const { spaceIds } = useSpaceSwitch()
  const [open, setOpen] = useState(false)
  if (spaceIds.length < 2) return null
  return (
    <>
      <button className="mx-auto mt-3 block text-sm text-muted" onClick={() => setOpen(true)}>
        Switch space
      </button>
      <SpaceSwitcherSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
