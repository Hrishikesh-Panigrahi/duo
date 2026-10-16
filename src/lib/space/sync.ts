// Loads a space's rows and keeps them live over Realtime row changes. Everything here is ciphertext.
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { errorMessage } from '../../components/ui'
import { must, supabase } from '../supabase'
import type { StoredContact, StoredItem, StoredList, StoredMember, StoredMessage, StoredNote, StoredSpace } from '../types'
import { MESSAGE_LIMIT, TABLES, sorted, type AnyRow, type Rows, type Table } from './rows'

export type RowChange = { type: 'upsert'; table: Table; row: AnyRow } | { type: 'remove'; table: Table; id: string }

export type SyncOptions = {
  spaceId: string
  userId: string
  onRows: (rows: Rows) => void
  onSpace: (space: StoredSpace) => void
  onMembers: (members: StoredMember[]) => void
  onChange: (change: RowChange) => void
  /** Your person's message just arrived (so they've stopped typing). */
  onPartnerMessage: () => void
  onError: (message: string) => void
}

export class SpaceSync {
  private alive = true
  private readonly changes: RealtimeChannel

  constructor(private readonly o: SyncOptions) {
    // A unique name: supabase.channel(name) hands back any channel with that name, even one a previous
    // mount is still tearing down, and reusing that one goes silently dead.
    this.changes = supabase.channel(`changes:${o.spaceId}:${Math.random().toString(36).slice(2)}`)
    for (const table of TABLES) {
      // Unfiltered: Realtime can't filter DELETEs, and RLS already limits the rest to our space.
      this.changes.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => this.applyChange(table, p))
    }
    for (const table of ['spaces', 'members']) {
      this.changes.on('postgres_changes', { event: '*', schema: 'public', table }, () => void this.loadMeta().catch(() => {}))
    }
    this.changes.subscribe((status) => {
      if (status === 'SUBSCRIBED') void this.reload() // catches anything that changed while (re)connecting
    })
    void this.reload()
  }

  /** Fetches everything again (the app came back to the foreground). */
  async reload() {
    try {
      const [rows] = await Promise.all([this.loadRows(), this.loadMeta()])
      if (this.alive) this.o.onRows(rows)
    } catch (e) {
      if (import.meta.env.DEV) console.error('Loading space failed', e)
      if (this.alive) this.o.onError(errorMessage(e))
    }
  }

  close() {
    this.alive = false
    void supabase.removeChannel(this.changes)
  }

  private async loadRows(): Promise<Rows> {
    const inSpace = (t: Table) => supabase.from(t).select('*').eq('space_id', this.o.spaceId)
    const [contacts, messages, notes, lists, list_items] = await Promise.all([
      must<StoredContact[]>(inSpace('contacts')),
      must<StoredMessage[]>(inSpace('messages').order('created_at', { ascending: false }).limit(MESSAGE_LIMIT)),
      must<StoredNote[]>(inSpace('notes')),
      must<StoredList[]>(inSpace('lists')),
      must<StoredItem[]>(inSpace('list_items')),
    ])
    return {
      contacts: sorted(contacts),
      messages: sorted(messages),
      notes: sorted(notes),
      lists: sorted(lists),
      list_items: sorted(list_items),
    }
  }

  private async loadMeta() {
    const [space, members] = await Promise.all([
      must<StoredSpace>(supabase.from('spaces').select('*').eq('id', this.o.spaceId).single()),
      must<StoredMember[]>(supabase.from('members').select('*').eq('space_id', this.o.spaceId).order('joined_at')),
    ])
    if (!this.alive) return
    this.o.onSpace(space)
    this.o.onMembers(members)
  }

  private applyChange(table: Table, p: RealtimePostgresChangesPayload<Record<string, unknown>>) {
    if (p.eventType === 'DELETE') {
      // A DELETE carries only the id; removing one we don't have is a no-op.
      const id = (p.old as Partial<AnyRow>).id
      if (id) this.o.onChange({ type: 'remove', table, id })
      return
    }
    const row = p.new as AnyRow & { space_id: string; sender_id?: string }
    if (row.space_id !== this.o.spaceId) return
    this.o.onChange({ type: 'upsert', table, row })
    if (table === 'messages' && p.eventType === 'INSERT' && row.sender_id !== this.o.userId) this.o.onPartnerMessage()
  }
}

// Realtime channels don't survive hot-swapping this module, so in dev an edit here reloads the page.
import.meta.hot?.dispose(() => location.reload())
