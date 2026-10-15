import { useCallback, useEffect, useRef, useState } from 'react'
import { Pin, Plus, StickyNote, Trash } from 'lucide-react'
import { useAuthorName, useSpace } from '../lib/store'
import type { Note } from '../lib/types'
import { ago } from '../lib/dates'
import { Button, EmptyState, IconButton, Sheet, cx, toast, toastError } from '../components/ui'

export function NotesTab() {
  const { notes } = useSpace()
  const authorName = useAuthorName()
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
            <button
              key={n.id}
              onClick={() => setEditing(n)}
              className="mb-3 block w-full break-inside-avoid rounded-2xl border border-line bg-surface p-3.5 text-left transition hover:border-accent/40"
            >
              <div className="flex items-start gap-2">
                {n.title && <div className="min-w-0 flex-1 font-semibold break-words">{n.title}</div>}
                {n.pinned && <Pin className="ml-auto size-4 shrink-0 fill-current text-accent" aria-label="Pinned" />}
              </div>
              {n.body && (
                <div className={cx('line-clamp-[10] text-sm break-words whitespace-pre-line', n.title && 'mt-1 text-muted')}>{n.body}</div>
              )}
              <div className="mt-2 text-xs text-muted">
                {authorName(n.created_by)} · {ago(n.updated_at)}
              </div>
            </button>
          ))}
        </div>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New note' : 'Note'}>
        <NoteEditor note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      </Sheet>
    </div>
  )
}

type Draft = Pick<Note, 'title' | 'body' | 'pinned'>

/**
 * Saves as you type (debounced) and once more on close. Saves run one at a
 * time so a fast typist can't create the same new note twice.
 */
function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const { actions } = useSpace()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [pinned, setPinned] = useState(note?.pinned ?? false)

  const latest = useRef<Draft>({ title, body, pinned })
  latest.current = { title, body, pinned }
  const saved = useRef<Draft>({ title: note?.title ?? '', body: note?.body ?? '', pinned: note?.pinned ?? false })
  const id = useRef<string | null>(note?.id ?? null)
  const discarded = useRef(false)
  const queue = useRef<Promise<void>>(Promise.resolve())

  const save = useCallback(
    (closing: boolean) => {
      queue.current = queue.current
        .then(async () => {
          if (discarded.current) return
          const draft = { ...latest.current }
          const empty = !draft.title.trim() && !draft.body.trim()
          if (empty) {
            // Cleared out completely: delete it, but only once you're done
            // (not mid-edit while you retype).
            if (closing && id.current) {
              await actions.deleteNote(id.current)
              id.current = null
            }
            return
          }
          const s = saved.current
          if (draft.title === s.title && draft.body === s.body && draft.pinned === s.pinned) return
          if (id.current) await actions.updateNote(id.current, draft)
          else id.current = (await actions.addNote(draft)).id
          saved.current = draft
        })
        .catch(toastError)
    },
    [actions],
  )

  useEffect(() => {
    const t = setTimeout(() => save(false), 700)
    return () => clearTimeout(t)
  }, [title, body, pinned, save])

  useEffect(() => () => save(true), [save])

  async function remove() {
    if (!confirm('Delete this note for both of you?')) return
    discarded.current = true
    try {
      await queue.current
      if (id.current) await actions.deleteNote(id.current)
      toast('Note deleted')
      onClose()
    } catch (e) {
      discarded.current = false
      toastError(e)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Title"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-muted"
        />
        <IconButton label={pinned ? 'Unpin' : 'Pin to top'} onClick={() => setPinned((p) => !p)} className={pinned ? 'text-accent' : 'text-muted'}>
          <Pin className={pinned ? 'fill-current' : ''} />
        </IconButton>
        {note && (
          <IconButton label="Delete note" onClick={remove} className="text-muted">
            <Trash />
          </IconButton>
        )}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write something…"
        aria-label="Note"
        autoFocus={!note}
        maxLength={20000}
        className="min-h-[45dvh] w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted"
      />
      <p className="text-xs text-muted">Saves automatically. {note ? `Last edited ${ago(note.updated_at)}.` : ''}</p>
    </div>
  )
}
