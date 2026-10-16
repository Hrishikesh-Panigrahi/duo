// Loads a space's rows and keeps them live over Supabase Realtime row changes.
// Everything here is ciphertext; decrypting is the store's job.
import { errorMessage } from '../../components/ui'
import { must, supabase } from '../supabase'
import type { StoredContact, StoredItem, StoredList, StoredMember, StoredMessage, StoredNote, StoredSpace } from '../types'
import { MESSAGE_LIMIT, TABLES, sorted, type AnyRow, type Rows, type Table } from './rows'

export type RowChange = { type: 'upsert'; table: Table; row: AnyRow } | { type: 'remove'; table: Table; id: string }

export function syncSpace(o: {
  spaceId: string
  userId: string
  onRows: (rows: Rows) => void
  onMeta: (space: StoredSpace, members: StoredMember[]) => void
  onChange: (change: RowChange) => void
  /** Your person's message just arrived (so they've stopped typing). */
  onPartnerMessage: () => void
  onError: (message: string) => void
}) {
  let alive = true

  const loadMeta = async () => {
    const [space, members] = await Promise.all([
      must<StoredSpace>(supabase.from('spaces').select('*').eq('id', o.spaceId).single()),
      must<StoredMember[]>(supabase.from('members').select('*').eq('space_id', o.spaceId).order('joined_at')),
    ])
    if (alive) o.onMeta(space, members)
  }

  const reload = async () => {
    const inSpace = (t: Table) => supabase.from(t).select('*').eq('space_id', o.spaceId)
    try {
      const [contacts, messages, notes, lists, list_items] = await Promise.all([
        must<StoredContact[]>(inSpace('contacts')),
        must<StoredMessage[]>(inSpace('messages').order('created_at', { ascending: false }).limit(MESSAGE_LIMIT)),
        must<StoredNote[]>(inSpace('notes')),
        must<StoredList[]>(inSpace('lists')),
        must<StoredItem[]>(inSpace('list_items')),
        loadMeta(),
      ])
      if (!alive) return
      o.onRows({
        contacts: sorted(contacts),
        messages: sorted(messages),
        notes: sorted(notes),
        lists: sorted(lists),
        list_items: sorted(list_items),
      })
    } catch (e) {
      if (import.meta.env.DEV) console.error('Loading space failed', e)
      if (alive) o.onError(errorMessage(e))
    }
  }

  // The channel's name is unique to this call: supabase.channel(name) hands
  // back any existing channel with that name, including one still being torn
  // down by a previous mount (StrictMode, hot reload, signing out and in), and
  // reusing that one goes silently dead.
  const changes = supabase.channel(`changes:${o.spaceId}:${Math.random().toString(36).slice(2)}`)

  for (const table of TABLES) {
    // Unfiltered on purpose: Realtime can't filter DELETEs, and RLS already
    // limits inserts/updates to our space. A DELETE only carries the id, so
    // removing an id we don't have is a no-op.
    changes.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as Partial<AnyRow>).id
        if (id) o.onChange({ type: 'remove', table, id })
        return
      }
      const row = p.new as AnyRow & { space_id: string; sender_id?: string }
      if (row.space_id !== o.spaceId) return
      o.onChange({ type: 'upsert', table, row })
      if (table === 'messages' && p.eventType === 'INSERT' && row.sender_id !== o.userId) o.onPartnerMessage()
    })
  }
  for (const table of ['spaces', 'members']) {
    changes.on('postgres_changes', { event: '*', schema: 'public', table }, () => void loadMeta().catch(() => {}))
  }
  changes.subscribe((status) => {
    if (status === 'SUBSCRIBED') void reload() // catches anything that changed while (re)connecting
  })
  void reload()

  return {
    /** Fetches everything again (the app came back to the foreground). */
    reload,
    close() {
      alive = false
      void supabase.removeChannel(changes)
    },
  }
}

// Realtime channels don't survive hot-swapping this module mid-session, so in
// dev an edit here reloads the page instead.
import.meta.hot?.dispose(() => location.reload())
