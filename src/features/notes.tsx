import { useEffect, useRef, useState } from 'react'
import { Pin, Plus, StickyNote, Trash } from 'lucide-react'
import { useAuthorName, useSpace } from '../lib/store'
import type { NoteActions } from '../lib/space/content-actions'
import type { Note } from '../lib/types'
import { ago } from '../lib/dates'
import { Button, EmptyState, IconButton, Sheet, cx, toast, toastError } from '../components/ui'

export function NotesTab() {
  const { notes } = useSpace()
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  return (
    <div className="h-full overflow-y-auto px-4 pt-4 pb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Notes</h2>
        <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setEditing('new')}>
          New note
        </Button>
      </div>
      {notes.length === 0 ? (
        <EmptyState icon={<StickyNote />} title="Notes you can both edit">
          The Wi-Fi password, gift ideas, the plan for Sunday. Long-press a chat message to save it here.
        </EmptyState>
      ) : (
        <div className="columns-2 gap-3">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={() => setEditing(n)} />
          ))}
        </div>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New note' : 'Note'}>
        <NoteEditor note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      </Sheet>
    </div>
  )
}

function NoteCard({ note: n, onOpen }: { note: Note; onOpen: () => void }) {
  const authorName = useAuthorName()
  return (
    <button
      onClick={onOpen}
      className="mb-3 block w-full break-inside-avoid rounded-2xl border border-line bg-surface p-3.5 text-left transition hover:border-accent/40"
    >
      <div className="flex items-start gap-2">
        {n.title && <div className="min-w-0 flex-1 font-semibold break-words">{n.title}</div>}
        {n.pinned && <Pin className="ml-auto size-4 shrink-0 fill-current text-accent" aria-label="Pinned" />}
      </div>
      {n.body && <div className={cx('line-clamp-[10] text-sm break-words whitespace-pre-line', n.title && 'mt-1 text-muted')}>{n.body}</div>}
      <div className="mt-2 text-xs text-muted">
        {authorName(n.created_by)} · {ago(n.updated_at)}
      </div>
    </button>
  )
}

type Draft = Pick<Note, 'title' | 'body' | 'pinned'>

/** Saves a note being edited, one save at a time, so a fast typist can't create the same new note twice. */
class NoteSaver {
  private queue: Promise<void> = Promise.resolve()
  private discarded = false
  private saved: Draft
  private id: string | null

  constructor(
    private readonly notes: NoteActions,
    note: Note | null,
    private readonly latest: () => Draft,
  ) {
    this.id = note?.id ?? null
    this.saved = { title: note?.title ?? '', body: note?.body ?? '', pinned: note?.pinned ?? false }
  }

  /** Saves whatever is latest by the time its turn comes. */
  save(closing: boolean) {
    this.queue = this.queue.then(() => this.write({ ...this.latest() }, closing)).catch(toastError)
  }

  /** Waits for any save in flight, then deletes the note for good. */
  async discard() {
    this.discarded = true
    try {
      await this.queue
      if (this.id) await this.notes.remove(this.id)
    } catch (e) {
      this.discarded = false
      throw e
    }
  }

  private async write(draft: Draft, closing: boolean) {
    if (this.discarded) return
    if (!draft.title.trim() && !draft.body.trim()) {
      // Cleared out completely: delete it, but only once you're done, not while you retype.
      if (closing && this.id) {
        await this.notes.remove(this.id)
        this.id = null
      }
      return
    }
    const s = this.saved
    if (draft.title === s.title && draft.body === s.body && draft.pinned === s.pinned) return
    if (this.id) await this.notes.update(this.id, draft)
    else this.id = (await this.notes.add(draft)).id
    this.saved = draft
  }
}

/** Saves as you type (after a pause) and once more on close. */
function useAutosave(note: Note | null, draft: Draft): NoteSaver {
  const { actions } = useSpace()
  const latest = useRef(draft)
  latest.current = draft
  const saver = useRef<NoteSaver | null>(null)
  saver.current ??= new NoteSaver(actions.notes, note, () => latest.current)
  const s = saver.current
  useEffect(() => {
    const t = setTimeout(() => s.save(false), 700)
    return () => clearTimeout(t)
  }, [draft, s])
  useEffect(() => () => s.save(true), [s])
  return s
}

function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({ title: note?.title ?? '', body: note?.body ?? '', pinned: note?.pinned ?? false }))
  const saver = useAutosave(note, draft)
  function remove() {
    if (!confirm('Delete this note for both of you?')) return
    saver.discard().then(() => {
      toast('Note deleted')
      onClose()
    }, toastError)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <TitleInput value={draft.title} onChange={(title) => setDraft((d) => ({ ...d, title }))} />
        <PinButton pinned={draft.pinned} onToggle={() => setDraft((d) => ({ ...d, pinned: !d.pinned }))} />
        {note && (
          <IconButton label="Delete note" onClick={remove} className="text-muted">
            <Trash />
          </IconButton>
        )}
      </div>
      <NoteBody note={note} value={draft.body} onChange={(body) => setDraft((d) => ({ ...d, body }))} />
    </div>
  )
}

function TitleInput({ value, onChange }: { value: string; onChange: (title: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Title"
      aria-label="Title"
      maxLength={200}
      className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-muted"
    />
  )
}

function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <IconButton label={pinned ? 'Unpin' : 'Pin to top'} onClick={onToggle} className={pinned ? 'text-accent' : 'text-muted'}>
      <Pin className={pinned ? 'fill-current' : ''} />
    </IconButton>
  )
}

function NoteBody({ note, value, onChange }: { note: Note | null; value: string; onChange: (body: string) => void }) {
  return (
    <>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write something…"
        aria-label="Note"
        autoFocus={!note}
        maxLength={20000}
        className="min-h-[45dvh] w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted"
      />
      <p className="text-xs text-muted">Saves automatically. {note ? `Last edited ${ago(note.updated_at)}.` : ''}</p>
    </>
  )
}
